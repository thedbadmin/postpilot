#!/bin/sh
# Pull the latest code from GitHub and rebuild PostPilot's containers.
# Data (database, images, LinkedIn login) lives in Docker volumes and is kept.
#   Run on the server:  /opt/postpilot/deploy.sh
set -eu

main() {  # wrapped in a function so the shell has read it all before git pull replaces this file
	cd "$(dirname "$0")"
	dc="docker compose -f docker-compose.server.yml"

	echo "== Backing up first"
	./backup.sh

	echo "== Fetching new code"
	old=$(git rev-parse --short HEAD)
	git pull --ff-only
	new=$(git rev-parse --short HEAD)
	[ "$old" = "$new" ] && echo "Already up to date ($new), rebuilding anyway."

	echo "== Rebuilding and restarting"
	$dc up -d --build --remove-orphans
	docker image prune -f >/dev/null

	echo "== Waiting for PostPilot to be healthy"
	for i in $(seq 1 30); do
		if $dc exec -T app python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:47821/health', timeout=3)" 2>/dev/null; then
			echo "Deployed $old -> $new. PostPilot is healthy."
			$dc ps
			return 0
		fi
		sleep 3
	done
	echo "PostPilot did not become healthy. Recent app logs:"
	$dc logs app --tail 40
	echo "To roll back: git checkout $old && $dc up -d --build"
	return 1
}

main "$@"
