# tf-nav (Terraform Navigator)

A Visual Studio Code extension that provides a structured tree view of Terraform configurations.

## Features

- **Tree View Navigation**: Browse Terraform resources in a hierarchical tree
- **Two View Modes**:
  - By Resource Type (group by aws_security_group, aws_instance, etc.)
  - By File (group by the file they are defined in)
- **Quick Navigation**: Jump directly from tree to source code
- **Copy Terraform Addresses**: Copy fully qualified resource addresses
- **Auto-refresh**: Automatically updates when Terraform files change

## Supported Terraform Blocks

- Resources (`resource`)
- Data sources (`data`)
- Modules (`module`)
- Variables (`variable`)
- Outputs (`output`)
- Locals (`locals`)

## Commands

- `Terraform Navigator: Refresh Index` - Manually refresh the tree view
- `Terraform Navigator: Switch View Mode` - Toggle between file and type view modes
- `Terraform Navigator: Reveal in Editor` - Jump to resource definition
- `Terraform Navigator: Copy Terraform Address` - Copy resource address to clipboard

## Configuration

- `tfnav.viewMode`: How to organize the tree view ("file" or "type")
- `tfnav.includeDataSources`: Include data sources in the tree view
- `tfnav.ignore`: Glob patterns for files/directories to ignore

## Development

This extension is currently in development. To run:

1. Clone the repository
2. Run `npm install`
3. Press F5 to launch the extension in a new VS Code window

## License

MIT
