# Regex Anchor

Create cross-file workspace anchor links from any regex pattern.

> **⚠️ Warning: This extension is currently in experimental stage. The API and configuration format may change without notice in future versions.**

## Features

* Allows text in files to function as links to corresponding locations in other files, based on patterns defined in `settings.json`.
* Link destinations are automatically indexed for easy navigation.
* Hover over links to see preview of destination content.
* Display inline preview directly in the editor alongside the link.

## How to Use

1. Add a setting like the following to your `settings.json`:

   ```json
   {
       "regexAnchor.rules": [
           {
               "from": [
                   {
                       "includes": "doc/*.md",
                       "patterns": "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"
                   }
               ],
               "to": [
                   {
                       "includes": "src/*.yaml",
                       "patterns": "id: ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})",
                       "preview": {
                           "linesBefore": 0,
                           "linesAfter": 3,
                           "hover": true,
                           "editor": "name: (.*?)$"
                       }
                   }
               ]
           }
       ]
   }
   ```

2. In the example above, UUID-formatted text in `doc/*.md` will become a link to the corresponding `id: <uuid>` line in `src/*.yaml` files.
3. Ctrl+click on the link to navigate to the corresponding line in the destination file.
4. Hovering over the link will show a preview of the destination (when `hover` is `true`).
5. If `editor` regex pattern is specified, matching content will be displayed inline next to the link.

## Configuration Options

### Preview Settings

- `linesBefore`: Number of lines to show before the target line (default: 2)
- `linesAfter`: Number of lines to show after the target line (default: 2)
- `hover`: Whether to enable hover preview (default: true)
- `editor`: Regex pattern to extract specific content for inline display in editor (optional)

### Example with inline display

When `editor` is set to `"name: (.*?)$"`, it will extract the name value from YAML files and display it inline:

```yaml
# src/users.yaml
id: 550e8400-e29b-41d4-a716-446655440000
name: John Doe
email: john@example.com
```

In your markdown file, the UUID will appear with inline text: `550e8400-e29b-41d4-a716-446655440000 → John Doe`

## Example

* Clicking a UUID like `550e8400-e29b-41d4-a716-446655440000` in a `doc/sample.md` file
* Will navigate to the line `id: 550e8400-e29b-41d4-a716-446655440000` in `src/config.yaml`.

## Commands

* `Regex Anchor: Refresh Link Index`: Manually refreshes the link index.

## Developer Information

* Press F5 to open a new VS Code window and run the extension in debug mode.
* Run `npm run package` to build the VSIX package.
