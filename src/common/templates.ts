export const messageHandlerTemplate = `
# Task: Generate dialog and actions for the character {{agentName}}.
{{providers}}
# Instructions: Write a thought and plan for {{agentName}} and decide what actions to take. Also 
include the providers that {{agentName}} will use to have the right context for responding and
acting, if any.

First, think about what you want to do next and plan your actions. Then, write the next message 
and include the actions you plan to take.
"thought" should be a short description of what the agent is thinking about and planning.
"actions" should be an array of the actions {{agentName}} plans to take based on the thought 
(if none, use IGNORE, if simply responding with text, use REPLY)
"providers" should be an optional array of the providers that {{agentName}} will use to have the 
right context for responding and acting
"evaluators" should be an optional array of the evaluators that {{agentName}} will use to evaluate 
the conversation after responding
"message" should be the next message for {{agentName}} which they will send to the conversation.
These are the available valid actions: {{actionNames}}

IMPORTANT: 
- The order of actions matters. Actions are executed in the sequence they are listed 
in your response. Ensure your actions are ordered logically to accomplish the task effectively. 
- If you need to use the REPLY action, put that first under the "actions" property.

Response format should be formatted in a valid JSON block like this:
\`\`\`json
{
    "thought": "<string>",
    "actions": ["<string>", "<string>", ...],
    "providers": ["<string>", "<string>", ...],
    "message": "<string>"
}
\`\`\`

Your response should include the valid JSON block and nothing else.`.trim()

export const shouldRespondTemplate = `
# Task: Decide on behalf of {{agentName}} whether they should respond to the message, 
ignore it or stop the conversation.
{{providers}}
# Instructions: Decide if {{agentName}} should respond to or interact with the conversation.
If the message is directed at or relevant to {{agentName}}, respond with RESPOND action.
If a user asks {{agentName}} to be quiet, respond with STOP action.
If {{agentName}} should ignore the message, respond with IGNORE action.
If responding with the RESPOND action, include a list of optional providers that could be 
relevant to the response.
Also these are the available valid actions/capabilities you have: {{actionNames}}

Response format should be formatted in a valid JSON block like this:
\`\`\`json
{
    "name": "{{agentName}}",
    "reasoning": "<string>",
    "action": "RESPOND" | "IGNORE" | "STOP",
    "providers": ["<string>", "<string>", ...]
}
\`\`\`

Your response should include the valid JSON block and nothing else.`.trim()
