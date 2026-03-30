#!/bin/bash
# UserPromptSubmit hook: open Feedback Coach dashboard when /feedback-coach is invoked

INPUT=$(cat)

# Check if the user's prompt is the feedback-coach command
PROMPT=$(echo "$INPUT" | jq -r '.prompt // .user_message // .input // empty' 2>/dev/null)

# Also check the raw input for the command name
if [ -z "$PROMPT" ]; then
  PROMPT="$INPUT"
fi

# Only trigger for the initial /feedback-coach command, not follow-up prompts
# Match only when the prompt starts with /feedback-coach (with optional whitespace)
echo "$PROMPT" | grep -qE '^\s*/feedback-coach' || exit 0

# Open the Feedback Coach dashboard
open http://localhost:3456/

exit 0
