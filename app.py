import eventlet
eventlet.monkey_patch()

import os
import math
import random
import uuid
from collections import defaultdict
from threading import Lock

from flask import Flask, request
from flask_socketio import SocketIO, emit, join_room, leave_room


app = Flask(__name__, static_folder="static", static_url_path="")
app.config["SECRET_KEY"] = "balance-scale-secret"
socketio = SocketIO(app, async_mode="eventlet", cors_allowed_origins="*")


lobbies = {}
lobbies_lock = Lock()
MIN_PLAYERS = 5
MAX_NAME_LENGTH = 24
LOBBY_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
LOBBY_CODE_LENGTH = 5
CLIENT_ID_MAX_LENGTH = 64

BASE_RULE = "Submit a whole number between 0 and 100. Closest to 0.8x the average wins."
ELIMINATION_RULES = {
    1: "Duplicate choices are disqualified and lose 1 extra point.",
    2: "Exact target hits make every other active player lose 2 points.",
    3: "If someone picks 0 and someone picks 100 in the same round, 100 wins immediately.",
}


def normalize_lobby_code(value):
    if value is None:
        return None
    if not isinstance(value, str):
        value = str(value)
    cleaned = "".join(ch for ch in value if ch.isalnum())
    return cleaned.upper() or None


def generate_lobby_code(length=LOBBY_CODE_LENGTH):
    return "".join(random.choice(LOBBY_CODE_ALPHABET) for _ in range(length))


def normalize_client_id(value):
    if value is None:
        return None
    if not isinstance(value, str):
        value = str(value)
    value = value.strip()
    if not value:
        return None
    return value[:CLIENT_ID_MAX_LENGTH]


def serialize_players(lobby, only_active=False):
    host_id = lobby.get("host_id")
    players = []
    for player_id, player in lobby["players"].items():
        if only_active and player["eliminated"]:
            continue
        players.append(
            {
                "id": player_id,
                "name": player["name"],
                "score": player["score"],
                "is_host": player_id == host_id,
                "eliminated": player["eliminated"],
                "is_bot": player.get("is_bot", False),
            }
        )
    return players


def broadcast_lobby_update(lobby_id):
    with lobbies_lock:
        lobby = lobbies.get(lobby_id)
        if not lobby:
            return
        host_id = lobby.get("host_id")
        host_name = None
        if host_id and host_id in lobby["players"]:
            host_name = lobby["players"][host_id]["name"]
        payload = {
            "lobby_id": lobby_id,
            "players": serialize_players(lobby),
            "host_id": host_id,
            "host_name": host_name,
            "state": lobby["state"],
            "round": lobby["round"],
            "awaiting_next_round": lobby.get("awaiting_next_round", False),
            "awaiting_choices": lobby.get("awaiting_choices", False),
            "player_count": len(lobby["players"]),
            "min_players": MIN_PLAYERS,
            "eliminations": lobby["eliminations"],
            "active_rules": get_active_rules(lobby["eliminations"]),
            "all_players_ready": all_active_players_ready(lobby),
        }
    socketio.emit("lobby_update", payload, room=lobby_id)


def assign_new_host(lobby):
    for player_id, player in lobby["players"].items():
        if not player["eliminated"] and not player.get("is_bot"):
            lobby["host_id"] = player_id
            return
    lobby["host_id"] = next(iter(lobby["players"]), None)


def calculate_target(choices):
    """Calculate the round target from the submitted choices."""
    if not choices:
        return 0.0
    average = sum(choices) / len(choices)
    return average * 0.8


def check_winner(lobby):
    """Return the last remaining active player if the game has ended."""
    active_players = [
        player for player in lobby["players"].values() if not player["eliminated"]
    ]
    if len(active_players) == 1:
        return active_players[0]
    return None


def get_active_players(lobby):
    return {
        player_id: player
        for player_id, player in lobby["players"].items()
        if not player["eliminated"]
    }


def apply_rules(lobby, target):
    active_players = get_active_players(lobby)
    elimination_count = lobby["eliminations"]
    disqualified = set()
    extra_penalties = defaultdict(int)
    rule_messages = []

    if elimination_count >= 1:
        number_groups = defaultdict(list)
        for player_id, player in active_players.items():
            number_groups[player["choice"]].append(player_id)

        duplicates = {
            number: ids for number, ids in number_groups.items() if len(ids) > 1
        }
        if duplicates:
            for ids in duplicates.values():
                for player_id in ids:
                    disqualified.add(player_id)
                    extra_penalties[player_id] += 1
            rule_messages.append("Duplicate choices were disqualified (-1 penalty).")

    winners = set()

    zero_choosers = [
        player_id
        for player_id, player in active_players.items()
        if player["choice"] == 0 and player_id not in disqualified
    ]
    hundred_choosers = [
        player_id
        for player_id, player in active_players.items()
        if player["choice"] == 100 and player_id not in disqualified
    ]
    if elimination_count >= 3 and zero_choosers and hundred_choosers:
        winners.update(hundred_choosers)
        rule_messages.append(
            "0/100 combo activated: player(s) with 100 win the round."
        )

    if not winners:
        closest_distance = None
        for player_id, player in active_players.items():
            if player_id in disqualified:
                continue
            distance = abs(player["choice"] - target)
            if closest_distance is None or distance < closest_distance - 1e-9:
                winners = {player_id}
                closest_distance = distance
            elif math.isclose(distance, closest_distance, rel_tol=1e-9, abs_tol=1e-6):
                winners.add(player_id)

    exact_target_hitters = []
    base_loss = 1
    if elimination_count >= 2:
        for player_id, player in active_players.items():
            if player_id in disqualified:
                continue
            if math.isclose(player["choice"], target, rel_tol=1e-9, abs_tol=1e-6):
                exact_target_hitters.append(player_id)
        if exact_target_hitters:
            base_loss = 2
            rule_messages.append("Exact target hit: all other players lose 2 points.")

    return {
        "target": target,
        "winners": winners,
        "disqualified": disqualified,
        "extra_penalties": extra_penalties,
        "exact_target_hitters": exact_target_hitters,
        "base_loss": base_loss,
        "rule_messages": rule_messages,
    }


def create_lobby_if_missing(lobby_id):
    if lobby_id not in lobbies:
        lobbies[lobby_id] = {
            "players": {},
            "state": "waiting",
            "round": 0,
            "eliminations": 0,
            "awaiting_choices": False,
            "awaiting_next_round": False,
            "host_id": None,
            "bot_counter": 0,
        }
    return lobbies[lobby_id]


def get_bot_players(lobby):
    return {
        player_id: player
        for player_id, player in lobby["players"].items()
        if player.get("is_bot")
    }


def remove_duplicate_clients(lobby, client_id, current_sid):
    """Remove any non-bot players that belong to the same physical client."""
    if not client_id:
        return [], False

    duplicates = []
    host_replaced = False
    for sid, player in list(lobby["players"].items()):
        if sid == current_sid or player.get("is_bot"):
            continue
        if player.get("client_id") == client_id:
            lobby["players"].pop(sid, None)
            duplicates.append(sid)
            if lobby.get("host_id") == sid:
                lobby["host_id"] = None
                host_replaced = True
    return duplicates, host_replaced


def normalize_display_name(name):
    if not isinstance(name, str):
        name = str(name) if name is not None else ""
    return name.strip().casefold()


def is_name_taken(lobby, player_name):
    target = normalize_display_name(player_name)
    for player in lobby["players"].values():
        if player.get("is_bot"):
            continue
        existing = normalize_display_name(player.get("name", ""))
        if existing and existing == target:
            return True
    return False


def all_active_players_ready(lobby):
    for player in get_active_players(lobby).values():
        if player.get("is_bot"):
            continue
        if not player.get("ready"):
            return False
    return True


def create_bot_player(lobby):
    lobby["bot_counter"] += 1
    bot_id = f"bot-{uuid.uuid4().hex}"
    bot_name = f"Bot {lobby['bot_counter']}"
    lobby["players"][bot_id] = {
        "id": bot_id,
        "name": bot_name,
        "score": 0,
        "choice": None,
        "eliminated": False,
        "is_bot": True,
        "ready": True,
    }
    return bot_id, lobby["players"][bot_id]


def generate_bot_choice(lobby, bot_id):
    _ = lobby, bot_id
    return random.randint(0, 100)


def get_active_rules(eliminations):
    rules = [BASE_RULE]
    for threshold in sorted(ELIMINATION_RULES):
        if eliminations >= threshold:
            rules.append(ELIMINATION_RULES[threshold])
    return rules


def eliminate_player(lobby_id, lobby, player_id):
    player = lobby["players"].get(player_id)
    if not player or player.get("is_bot") or player.get("eliminated"):
        return None

    previous_eliminations = lobby["eliminations"]
    player["eliminated"] = True
    player["choice"] = None
    player["ready"] = False
    if player["score"] > -10:
        player["score"] = -10

    lobby["eliminations"] += 1
    elimination_number = lobby["eliminations"]
    unlocked_rules = [
        ELIMINATION_RULES.get(count)
        for count in range(previous_eliminations + 1, elimination_number + 1)
        if ELIMINATION_RULES.get(count)
    ]

    return {
        "lobby_id": lobby_id,
        "name": player["name"],
        "score": player["score"],
        "eliminations": elimination_number,
        "active_rules": get_active_rules(elimination_number),
        "new_rules": unlocked_rules,
    }


def begin_round(lobby_id):
    with lobbies_lock:
        lobby = lobbies.get(lobby_id)
        if not lobby or lobby["state"] != "running":
            return

        active_players = get_active_players(lobby)
        if len(active_players) <= 1:
            return

        lobby["round"] += 1
        lobby["awaiting_choices"] = True
        lobby["awaiting_next_round"] = False
        for player in lobby["players"].values():
            player["choice"] = None
            if not player.get("is_bot"):
                player["ready"] = False

        round_number = lobby["round"]
        player_status = serialize_players(lobby, only_active=True)
        has_bots = any(player.get("is_bot") for player in lobby["players"].values())

    socketio.emit(
        "game_started",
        {
            "lobby_id": lobby_id,
            "round": round_number,
            "players": player_status,
            "eliminations": lobby["eliminations"],
            "active_rules": get_active_rules(lobby["eliminations"]),
            "awaiting_choices": True,
        },
        room=lobby_id,
    )

    if has_bots:
        socketio.start_background_task(run_bot_submissions, lobby_id)

    broadcast_lobby_update(lobby_id)


def reset_lobby_state(lobby_id):
    eventlet.sleep(0.1)
    with lobbies_lock:
        lobby = lobbies.get(lobby_id)
        if not lobby:
            return

        for player in lobby["players"].values():
            player["score"] = 0
            player["choice"] = None
            player["eliminated"] = False
            player["ready"] = True if player.get("is_bot") else False

        lobby["state"] = "waiting"
        lobby["round"] = 0
        lobby["eliminations"] = 0
        lobby["awaiting_choices"] = False
        lobby["awaiting_next_round"] = False

    broadcast_lobby_update(lobby_id)


def evaluate_round(lobby_id):
    elimination_notifications = []
    round_payload = {}
    game_over_payload = None

    with lobbies_lock:
        lobby = lobbies.get(lobby_id)
        if not lobby or lobby["state"] != "running":
            return

        active_players = get_active_players(lobby)
        if not active_players:
            return

        choices = [player["choice"] for player in active_players.values()]
        if any(choice is None for choice in choices):
            return

        average_value = sum(choices) / len(choices) if choices else 0.0
        target = calculate_target(choices)
        rule_result = apply_rules(lobby, target)
        winners = rule_result["winners"]
        base_loss = rule_result["base_loss"]
        extra_penalties = rule_result["extra_penalties"]
        disqualified = rule_result["disqualified"]
        rule_messages = rule_result["rule_messages"]

        scores_before = {
            player["name"]: player["score"] for player in lobby["players"].values()
        }

        for player_id, player in active_players.items():
            if player_id in winners:
                continue
            penalty = base_loss + extra_penalties.get(player_id, 0)
            player["score"] -= penalty
            player["penalty"] = penalty

        submitted_numbers = {
            player["name"]: player["choice"]
            for player in lobby["players"].values()
            if player["choice"] is not None
        }

        eliminated_this_round = []
        for player_id, player in active_players.items():
            if player["score"] <= -10 and not player["eliminated"]:
                player["eliminated"] = True
                lobby["eliminations"] += 1
                elimination_number = lobby["eliminations"]
                eliminated_this_round.append(
                    {
                        "player_id": player_id,
                        "name": player["name"],
                        "score": player["score"],
                        "elimination_number": elimination_number,
                        "is_bot": player.get("is_bot", False),
                    }
                )

        lobby["awaiting_choices"] = False

        scores_after = {
            player["name"]: player["score"] for player in lobby["players"].values()
        }
        winner_names = [
            lobby["players"][player_id]["name"] for player_id in winners
        ]
        disqualified_names = [
            lobby["players"][player_id]["name"] for player_id in disqualified
        ]

        round_payload = {
            "lobby_id": lobby_id,
            "round": lobby["round"],
            "target": target,
            "average": average_value,
            "winners": winner_names,
            "choices": submitted_numbers,
            "scores_before": scores_before,
            "scores_after": scores_after,
            "disqualified": disqualified_names,
            "rule_messages": rule_messages,
            "players_after": serialize_players(lobby),
            "eliminations": lobby["eliminations"],
            "active_rules": get_active_rules(lobby["eliminations"]),
            "awaiting_choices": lobby.get("awaiting_choices", False),
        }

        if eliminated_this_round:
            initial_eliminations = lobby["eliminations"] - len(eliminated_this_round) + 1
            eliminated_this_round.sort(key=lambda x: x["elimination_number"])
            unlocked_rules = [
                ELIMINATION_RULES.get(count)
                for count in range(initial_eliminations, lobby["eliminations"] + 1)
                if ELIMINATION_RULES.get(count)
            ]

            for eliminated in eliminated_this_round:
                elimination_number = eliminated.get("elimination_number", lobby["eliminations"])
                elimination_notifications.append(
                    {
                        "lobby_id": lobby_id,
                        "name": eliminated["name"],
                        "score": eliminated["score"],
                        "eliminations": elimination_number,
                        "active_rules": get_active_rules(elimination_number),
                        "new_rules": unlocked_rules,
                    }
                )

        winner = check_winner(lobby)
        if winner:
            lobby["state"] = "finished"
            game_over_payload = {
                "lobby_id": lobby_id,
                "winner": winner["name"],
                "score": winner["score"],
            }
        else:
            lobby["awaiting_next_round"] = True

    if round_payload:
        round_payload["awaiting_next_round"] = game_over_payload is None
        socketio.emit("round_result", round_payload, room=lobby_id)

    for elimination in elimination_notifications:
        socketio.emit("player_eliminated", elimination, room=lobby_id)

    if game_over_payload:
        socketio.emit("game_over", game_over_payload, room=lobby_id)
        socketio.start_background_task(reset_lobby_state, lobby_id)
    else:
        broadcast_lobby_update(lobby_id)


def run_bot_submissions(lobby_id):
    eventlet.sleep(random.uniform(0.6, 1.2))
    while True:
        should_evaluate = False
        with lobbies_lock:
            lobby = lobbies.get(lobby_id)
            if (
                not lobby
                or lobby["state"] != "running"
                or not lobby.get("awaiting_choices")
            ):
                return

            pending_bots = [
                (player_id, player)
                for player_id, player in lobby["players"].items()
                if player.get("is_bot")
                and not player["eliminated"]
                and player["choice"] is None
            ]

            if not pending_bots:
                return

            bot_id, bot = pending_bots[0]
            bot["choice"] = generate_bot_choice(lobby, bot_id)

            should_evaluate = all(
                player["choice"] is not None
                for player in lobby["players"].values()
                if not player["eliminated"]
            )

        if should_evaluate:
            evaluate_round(lobby_id)
            return

        eventlet.sleep(random.uniform(0.4, 0.9))


@socketio.on("connect")
def handle_connect():
    emit("connected", {"sid": request.sid})


@socketio.on("disconnect")
def handle_disconnect():
    removed_lobby_id = None
    elimination_notice = None
    should_evaluate = False
    with lobbies_lock:
        for lobby_id, lobby in lobbies.items():
            if request.sid in lobby["players"]:
                player = lobby["players"].get(request.sid)
                if lobby["state"] == "running":
                    elimination_notice = eliminate_player(lobby_id, lobby, request.sid)
                lobby["players"].pop(request.sid, None)
                if lobby["host_id"] == request.sid:
                    assign_new_host(lobby)
                leave_room(lobby_id)
                remaining_active = len(get_active_players(lobby))
                if lobby["state"] == "running" and remaining_active <= 1:
                    winner = check_winner(lobby)
                    if winner:
                        lobby["state"] = "finished"
                        payload = {
                            "lobby_id": lobby_id,
                            "winner": winner["name"],
                            "score": winner["score"],
                        }
                        socketio.emit("game_over", payload, room=lobby_id)
                        socketio.start_background_task(reset_lobby_state, lobby_id)
                elif (
                    lobby["state"] == "running"
                    and lobby.get("awaiting_choices")
                    and all(
                        p["choice"] is not None
                        for p in lobby["players"].values()
                        if not p["eliminated"]
                    )
                ):
                    should_evaluate = True
                removed_lobby_id = lobby_id
                break
    if removed_lobby_id:
        broadcast_lobby_update(removed_lobby_id)
    if elimination_notice:
        socketio.emit("player_eliminated", elimination_notice, room=removed_lobby_id)
    if should_evaluate and removed_lobby_id:
        evaluate_round(removed_lobby_id)


@socketio.on("create_lobby")
def handle_create_lobby(data):
    player_name = str(data.get("player_name", "")).strip()
    if not player_name:
        emit("error", {"message": "player_name is required"})
        return
    player_name = player_name[:MAX_NAME_LENGTH]
    client_id = normalize_client_id(data.get("client_id")) or request.sid

    lobby_id = None
    with lobbies_lock:
        for _ in range(12):
            candidate = generate_lobby_code()
            if candidate not in lobbies:
                lobby_id = candidate
                create_lobby_if_missing(candidate)
                break

    if not lobby_id:
        emit("error", {"message": "Unable to create a lobby right now. Please try again."})
        return

    join_room(lobby_id)

    with lobbies_lock:
        lobby = lobbies.get(lobby_id) or create_lobby_if_missing(lobby_id)
        lobby["players"][request.sid] = {
            "id": request.sid,
            "name": player_name,
            "score": 0,
            "choice": None,
            "eliminated": False,
            "client_id": client_id,
            "ready": False,
        }
        lobby["host_id"] = request.sid

    emit("lobby_created", {"lobby_id": lobby_id}, room=request.sid)
    broadcast_lobby_update(lobby_id)


@socketio.on("join_lobby")
def handle_join_lobby(data):
    raw_lobby_id = data.get("lobby_id")
    lobby_id = normalize_lobby_code(raw_lobby_id)
    player_name = str(data.get("player_name", "")).strip()
    client_id = normalize_client_id(data.get("client_id")) or request.sid

    if not player_name:
        emit("error", {"message": "player_name is required"})
        return

    if not lobby_id:
        emit("error", {"message": "Lobby code is required."})
        return

    player_name = player_name[:MAX_NAME_LENGTH]

    join_room(lobby_id)
    duplicate_sids = []
    host_replaced = False

    with lobbies_lock:
        lobby = lobbies.get(lobby_id)
        if not lobby:
            if lobby_id == "DEFAULT":
                lobby = create_lobby_if_missing(lobby_id)
            else:
                leave_room(lobby_id)
                emit(
                    "error",
                    {"message": "Lobby code not found. Double-check the code and try again."},
                )
                return

        if lobby["state"] == "running" or lobby["state"] == "finished":
            leave_room(lobby_id)
            emit("error", {"message": "Lobby is full or already in progress."})
            return

        duplicates, replaced_host = remove_duplicate_clients(lobby, client_id, request.sid)
        duplicate_sids.extend(duplicates)
        host_replaced = host_replaced or replaced_host

        if is_name_taken(lobby, player_name):
            leave_room(lobby_id)
            emit(
                "error",
                {
                    "message": "Dieser Anzeigename ist bereits vergeben. Bitte wähle einen anderen."
                },
            )
            return

        while len(lobby["players"]) >= MIN_PLAYERS:
            bot_candidates = [
                player_id
                for player_id, player in lobby["players"].items()
                if player.get("is_bot")
            ]
            if not bot_candidates:
                leave_room(lobby_id)
                emit("error", {"message": "Lobby is full or already in progress."})
                return
            lobby["players"].pop(bot_candidates[0], None)

        lobby["players"][request.sid] = {
            "id": request.sid,
            "name": player_name,
            "score": 0,
            "choice": None,
            "eliminated": False,
            "client_id": client_id,
            "ready": False,
        }

        if host_replaced or lobby["host_id"] is None:
            lobby["host_id"] = request.sid

    emit("joined_lobby", {"lobby_id": lobby_id}, room=request.sid)
    broadcast_lobby_update(lobby_id)

    for sid in duplicate_sids:
        socketio.server.disconnect(sid)


@socketio.on("host_start_round")
def handle_host_start_round(data):
    lobby_id = normalize_lobby_code(data.get("lobby_id")) or "DEFAULT"
    with lobbies_lock:
        lobby = lobbies.get(lobby_id)
        if not lobby:
            emit("error", {"message": "Lobby not found."})
            return

        if lobby.get("host_id") != request.sid:
            emit("error", {"message": "Only the host can start rounds."})
            return

        if lobby["state"] == "finished":
            emit("error", {"message": "Game has already finished."})
            return

        active_players = get_active_players(lobby)
        if len(active_players) < 2:
            emit("error", {"message": "Not enough active players to continue."})
            return

        if lobby["state"] == "waiting":
            if len(lobby["players"]) < MIN_PLAYERS:
                emit(
                    "error",
                    {
                        "message": f"Need at least {MIN_PLAYERS} players to start the first round."
                    },
                )
                return
            if not all_active_players_ready(lobby):
                emit("error", {"message": "Waiting for every player to be ready."})
                return
            lobby["state"] = "running"
        elif not lobby.get("awaiting_next_round"):
            emit("error", {"message": "Round already in progress."})
            return
        elif not all_active_players_ready(lobby):
            emit("error", {"message": "Waiting for every player to be ready."})
            return

        lobby["awaiting_next_round"] = False

    begin_round(lobby_id)


@socketio.on("fill_with_bots")
def handle_fill_with_bots(data):
    lobby_id = normalize_lobby_code(data.get("lobby_id")) or "DEFAULT"
    requested = data.get("count")

    with lobbies_lock:
        lobby = lobbies.get(lobby_id)
        if not lobby:
            emit("error", {"message": "Lobby not found."})
            return

        if lobby.get("host_id") != request.sid:
            emit("error", {"message": "Only the host can add bots."})
            return

        if lobby["state"] == "running" and lobby.get("awaiting_choices"):
            emit("error", {"message": "Wait for the round to finish before adding bots."})
            return

        available_slots = max(0, MIN_PLAYERS - len(lobby["players"]))
        if available_slots <= 0:
            emit("error", {"message": "Lobby already has the maximum number of players."})
            return

        try:
            requested_count = int(requested) if requested is not None else available_slots
        except (TypeError, ValueError):
            requested_count = available_slots

        bots_to_add = max(0, min(requested_count, available_slots))
        if bots_to_add == 0:
            emit("error", {"message": "No available slots for bots."})
            return

        for _ in range(bots_to_add):
            create_bot_player(lobby)

    broadcast_lobby_update(lobby_id)


@socketio.on("player_ready")
def handle_player_ready(data):
    lobby_id = normalize_lobby_code(data.get("lobby_id")) or "DEFAULT"
    with lobbies_lock:
        lobby = lobbies.get(lobby_id)
        if not lobby:
            return
        player = lobby["players"].get(request.sid)
        if not player or player.get("is_bot") or player["eliminated"]:
            return
        player["ready"] = True
    broadcast_lobby_update(lobby_id)


@app.route("/")
def index():
    return app.send_static_file("index.html")


@socketio.on("submit_number")
def handle_submit_number(data):
    lobby_id = normalize_lobby_code(data.get("lobby_id")) or "DEFAULT"
    try:
        number = float(data.get("number"))
    except (TypeError, ValueError):
        emit("error", {"message": "Invalid number submission."})
        return

    if not math.isfinite(number):
        emit("error", {"message": "Invalid number submission."})
        return

    if not float(number).is_integer():
        emit("error", {"message": "Only whole numbers between 0 and 100 are allowed."})
        return

    number = int(number)
    if number < 0 or number > 100:
        emit("error", {"message": "Number must be between 0 and 100."})
        return

    should_evaluate = False

    with lobbies_lock:
        lobby = lobbies.get(lobby_id)
        if not lobby or lobby["state"] != "running":
            emit("error", {"message": "Lobby not running."})
            return

        player = lobby["players"].get(request.sid)
        if not player or player["eliminated"]:
            emit("error", {"message": "Player not eligible to play."})
            return

        if not lobby["awaiting_choices"]:
            emit("error", {"message": "Round not accepting submissions."})
            return

        player["choice"] = number

        if all(
            p["choice"] is not None
            for p in lobby["players"].values()
            if not p["eliminated"]
        ):
            should_evaluate = True

    if should_evaluate:
        evaluate_round(lobby_id)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    socketio.run(app, host="0.0.0.0", port=port)
