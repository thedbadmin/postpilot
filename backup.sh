#!/bin/sh
# Back up the database and the app data volume (secrets.json + images). Keeps 14 days.
# Cron (daily 03:30):  30 3 * * * /opt/postpilot/backup.sh >> /opt/postpilot/backups/backup.log 2>&1
# ponytail: backups stay on this VPS; copy backups/ off the server (rclone/scp) to survive losing the VPS.
set -eu
umask 077  # backups contain the LinkedIn token and API keys
cd "$(dirname "$0")"
dc="docker compose -f docker-compose.server.yml"
ts=$(date +%F_%H%M)
mkdir -p backups
$dc exec -T db pg_dump -U postpilot -Fc postpilot > "backups/db_$ts.dump"
# videos (*.mp4, up to 500 MB each) are skipped to keep backups small; a restored video post needs its video re-attached
$dc exec -T app tar czf - --exclude='*.mp4' -C /data . > "backups/data_$ts.tgz"
[ -s "backups/db_$ts.dump" ] && [ -s "backups/data_$ts.tgz" ] || { echo "$ts backup FAILED"; exit 1; }
find backups -name 'db_*.dump' -mtime +14 -delete
find backups -name 'data_*.tgz' -mtime +14 -delete
echo "$ts backup ok"
