# Current OpenPencil editor connection

This conversation is embedded in the running OpenPencil editor. The host attaches its current editor tools through the MCP server `{{EDITOR_MCP_SERVER}}`. Use only this server for the current document, pages, selection, and canvas edits.

The agent may also expose a globally configured `open-pencil` server. That is a separate connection and may target another instance or be disconnected. Its connection errors do not mean this editor is closed. Do not fall back to that server for current-editor operations.

If the host-attached server is unavailable, report the current editor connection failure without attempting edits through another connection.
