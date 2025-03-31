#!/usr/bin/env bash

# Check if Bun is installed globally
if ! command -v bun &> /dev/null; then
  echo "Bun is not installed. Please install it first:"
  echo "curl -fsSL https://bun.sh/install | bash"
  exit 1
fi


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
(cd "$projectName" && bun i) || {
  echo "Failed to install dependencies"
  cd "$ORIGINAL_DIR"
  exit 1
}
cd "$ORIGINAL_DIR"


# Create data directory if it doesn't exist
mkdir -p "$dataDir"

# Get the directory where this script is located
ORIGINAL_DIR=$(pwd)
SCRIPT_DIR=""
if ! SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"; then
    echo "Error: Failed to determine script location" >&2
    exit 1
fi
cd "$ORIGINAL_DIR" # Return to original directory

# Get the parent directory (project root)
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Run create-agent script with bun
bun run "$PROJECT_ROOT/scripts/create-agent.ts" "$dataDir" "$agentName" "$agentPurpose"

# Display success message with a nice box
echo
echo "┌──────────────────────────────────────────────────────────────────────┐"
echo "│                                                                      │"
echo "│  ✓ Repository cloned successfully!                                   │"
echo "│                                                                      │"
echo "│  Next steps:                                                         │"
echo "│                                                                      │"
echo "│  1. Add your OpenAI API key to .env:                                 │"
echo "│     OPENAI_API_KEY=your_api_key_here                                 │"
echo "│                                                                      │"
echo "│  2. Install dependencies with: bun install                           │"
echo "│                                                                      │"
echo "└──────────────────────────────────────────────────────────────────────┘"
echo

