# Regex Anchor

Create cross-file workspace anchor links from any regex pattern.

## Features

* Allows text in files to function as links to corresponding locations in other files, based on patterns defined in `settings.json`.
* Link destinations are automatically indexed for easy navigation.

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
                       "patterns": "id: ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"
                   }
               ]
           }
       ]
   }
   ```

2. In the example above, UUID-formatted text in `doc/*.md` will become a link to the corresponding `id: <uuid>` line in `src/*.yaml` files.
3. Clicking the link will navigate to the corresponding line in the destination file.
4. Hovering over the link will show a preview of the destination.

## Example

* Clicking a UUID like `550e8400-e29b-41d4-a716-446655440000` in a `doc/sample.md` file
* Will navigate to the line `id: 550e8400-e29b-41d4-a716-446655440000` in `src/config.yaml`.

## Commands

* `Regex Anchor: Refresh Link Index`: Manually refreshes the link index.

## Developer Information

* Press F5 to open a new VS Code window and run the extension in debug mode.
* Run `npm run package` to build the VSIX package.
