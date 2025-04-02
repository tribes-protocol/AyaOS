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
git clone -b avp/characterUpdate https://github.com/tribes-protocol/ayaos "$projectName"
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

# Move character.json file from project root to the new project directory
# Find and move any character.json files from src/characters to the new project's src/characters directory
mkdir -p "$projectName/src/characters"
for character_file in "$PROJECT_ROOT/src/characters"/*.character.json; do
  if [ -f "$character_file" ]; then
    filename=$(basename "$character_file")
    echo "Moving $filename to $projectName/src/characters directory..."
    mv "$character_file" "$projectName/src/characters/$filename"
    echo "$filename moved successfully."
  fi
done

# Check if any character files were found
if [ ! -f "$projectName/src/characters"/*.character.json ]; then
  echo "Warning: No character.json files found in $PROJECT_ROOT/src/characters"
fi


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

