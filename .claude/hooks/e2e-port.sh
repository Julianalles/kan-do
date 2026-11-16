#!/usr/bin/env bash
# Prints a port for the pre-merge gate's E2E server (#349): random in 3200-3899, never one Chromium blocks
# (ERR_UNSAFE_PORT, e.g. 3659 apple-sasl) and never one that is already listening.
# E2E_PORT_START (test seam) replaces the random first candidate.

unsafe=" 1 7 9 11 13 15 17 19 20 21 22 23 25 37 42 43 53 69 77 79 87 95 101 102 103 104 109 110 111 113 115 117 119 123 135 137 139 143 161 179 389 427 465 512 513 514 515 526 530 531 532 540 548 554 556 563 587 601 636 989 990 993 995 1719 1720 1723 2049 3659 4045 4190 5060 5061 6000 6566 6665 6666 6667 6668 6669 6679 6697 10080 "
lo=3200
span=700
start=${E2E_PORT_START:-$((lo + RANDOM % span))}
case $start in '' | *[!0-9]*) start=$((lo + RANDOM % span)) ;; esac
[ "$start" -ge "$lo" ] && [ "$start" -lt $((lo + span)) ] || start=$((lo + RANDOM % span))

i=0
while [ "$i" -lt "$span" ]; do
  port=$((lo + (start - lo + i) % span))
  i=$((i + 1))
  case "$unsafe" in *" $port "*) continue ;; esac
  lsof -ti "tcp:$port" -sTCP:LISTEN >/dev/null 2>&1 && continue
  echo "$port"
  exit 0
done
echo "e2e-port: no free safe port in $lo-$((lo + span - 1))" >&2
exit 1
