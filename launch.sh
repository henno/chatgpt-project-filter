#!/bin/bash
# Start ChatGPT with the project-filter injector. Safe to run repeatedly.
PORT=9222
DIR="$(cd "$(dirname "$0")" && pwd)"
NODE="${NODE:-$(command -v node || echo /opt/homebrew/bin/node)}"
export CHATGPT_DEBUG_PORT=$PORT

port_up() { curl -s -m 1 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; }

if ! port_up; then
  if pgrep -f "ChatGPT.app/Contents/MacOS/ChatGPT" >/dev/null; then
    osascript -e 'display dialog "ChatGPT is running without the project filter. Restart it now? Running sessions will be interrupted." buttons {"Cancel","Restart"} default button "Restart" with icon caution' >/dev/null 2>&1 || exit 0
    osascript -e 'tell application "ChatGPT" to quit'
    for _ in $(seq 1 30); do pgrep -f "ChatGPT.app/Contents/MacOS/ChatGPT" >/dev/null || break; sleep 0.5; done
  fi
  open -a /Applications/ChatGPT.app --args --remote-debugging-port=$PORT
  for _ in $(seq 1 40); do port_up && break; sleep 0.5; done
fi

pgrep -f "$DIR/inject.mjs" >/dev/null || nohup "$NODE" "$DIR/inject.mjs" >"$DIR/inject.log" 2>&1 &
