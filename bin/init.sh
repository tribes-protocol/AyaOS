#!/usr/bin/env bash

# Validate command line arguments
if [ $# -ne 1 ]; then
  echo "Error: 'init' command required"
  echo "Usage: ayaos init"
  exit 1
fi

if [ "$1" != "init" ]; then
  echo "Error: Invalid argument '$1'"
  echo "Usage: ayaos init"
  exit 1
fi

# Check if Bun is installed globally
if ! command -v bun &> /dev/null; then
  echo "Bun is not installed. Please install it first:"
  echo "curl -fsSL https://bun.sh/install | bash"
  exit 1
fi

# Debug info about environment
echo "===== ENVIRONMENT DEBUG ====="
echo "Current working directory: $(pwd)"
echo "PATH: $PATH"
echo "Which bun: $(command -v bun)"
echo "Shell: $SHELL"
echo "============================="

# 1. Ask user what they want to name the project
read -p "What do you want to name the project? " projectName

# 2. Where do you want the data directory to be?
while true; do
  read -p "Where do you want the data directory to be? (Please provide full path) " dataDir
  # Exit if empty
  if [[ -z "$dataDir" ]]; then
    echo "Data directory path is required. Exiting..."
    exit 1
  fi
  # Expand ~ to home directory if present
  dataDir="${dataDir/#\~/$HOME}"
  # Validate that dataDir is a full path
  if [[ "$dataDir" != /* ]]; then
    echo "Error: Please provide a full path starting with '/' or '~'"
    continue
  fi

  break
done

# 3. What is your agent's name?
read -p "What is your agent's name? " agentName
# 4. What is your agent's purpose?
read -p "What is your agent's purpose? " agentPurpose

# Clone the repository into the project directory
git clone https://github.com/tribes-protocol/agent "$projectName"
# Remove .git directory
rm -rf "$projectName/.git"

# Create .env file with data directory
echo "DATA_DIR=\"$dataDir\"" > "$projectName/.env"

# Move into project directory and install dependencies
ORIGINAL_DIR=$(pwd)
(
  cd "$projectName" || exit 1
  echo "===== Installing dependencies in $(pwd) ====="
  bun i
) || {
  echo "Failed to install dependencies"
  cd "$ORIGINAL_DIR"
  exit 1
}
cd "$ORIGINAL_DIR"

# Create data directory if it doesn't exist
mkdir -p "$dataDir"

# Get the directory where this script is located
SCRIPT_DIR=""
if ! SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"; then
    echo "Error: Failed to determine script location" >&2
    exit 1
fi

echo "===== SCRIPT LOCATION DEBUG ====="
echo "Script directory (SCRIPT_DIR): $SCRIPT_DIR"
echo "Listing contents of SCRIPT_DIR:"
ls -la "$SCRIPT_DIR"
echo

# Get the parent directory (project root)
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "PROJECT_ROOT: $PROJECT_ROOT"
echo "Listing contents of PROJECT_ROOT:"
ls -la "$PROJECT_ROOT"
echo
echo "Listing contents of PROJECT_ROOT/scripts:"
ls -la "$PROJECT_ROOT/scripts" || echo "No scripts directory found at $PROJECT_ROOT/scripts"
echo

# Check explicitly if create-agent.ts exists
if [ ! -f "$PROJECT_ROOT/scripts/create-agent.ts" ]; then
  echo "ERROR: $PROJECT_ROOT/scripts/create-agent.ts does NOT exist."
  echo "Terminating."
  exit 1
fi

# Everything should be good; let's run create-agent
echo "===== RUNNING create-agent.ts ====="
(
  cd "$projectName" || exit 1
  # If Bun requires 'tsx' usage:
  # bun run tsx "$PROJECT_ROOT/scripts/create-agent.ts" "$dataDir" "$agentName" "$agentPurpose"
  bun run "$PROJECT_ROOT/scripts/create-agent.ts" "$dataDir" "$agentName" "$agentPurpose"
) || {
  echo "Failed to create agent"
  cd "$ORIGINAL_DIR"
  exit 1
}
cd "$ORIGINAL_DIR"

# Display success message with a nice box
echo
echo "┌──────────────────────────────────────────────────────────────────────┐"
echo "│                                                                      │"
echo "│  ✓ Repository cloned successfully!                                   │"
echo "│                                                                      │"
echo "│  Next steps:                                                         │"
echo "│                                                                      │"
echo "│  1. cd $projectName                                                  │"
echo "│                                                                      │"
echo "│  2. Add your OpenAI API key to .env:                                 │"
echo "│     OPENAI_API_KEY=your_api_key_here                                 │"
echo "│                                                                      │"
echo "│  3. Run the development server with: bun dev                         │"
echo "│                                                                      │"
echo "└──────────────────────────────────────────────────────────────────────┘"
echo
