# Terraform Navigator

[![Visual Studio Marketplace](https://img.shields.io/visual-studio-marketplace/v/owenrumney.tf-nav?style=flat-square&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=owenrumney.tf-nav)
[![Downloads](https://img.shields.io/visual-studio-marketplace/d/owenrumney.tf-nav?style=flat-square)](https://marketplace.visualstudio.com/items?itemName=owenrumney.tf-nav)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/owenrumney.tf-nav?style=flat-square)](https://marketplace.visualstudio.com/items?itemName=owenrumney.tf-nav)

Navigate your Terraform infrastructure with ease! Terraform Navigator provides a powerful tree view and dependency graph visualization for your Terraform configurations, making it simple to understand and navigate complex infrastructure code.

![tf-nav preview](.github/images/tf-nav.gif)

## ✨ Features

### 🌳 **Smart Tree Navigation**

- **Hierarchical File View**: Browse your Terraform files in their actual directory structure
- **Resource Type View**: Group resources by type (aws_instance, aws_security_group, etc.)
- **Instant Code Navigation**: Click any resource to jump directly to its definition
- **Real-time Updates**: Automatically refreshes when you modify Terraform files

### 📊 **Interactive Dependency Graph**

- **Visual Dependencies**: See how your resources connect and depend on each other
- **Interactive Exploration**: Click nodes to focus on specific resources and their relationships
- **Provider-Aware Styling**: Resources are color-coded by provider (AWS, Azure, GCP, etc.)
- **Full Resource Names**: Displays complete provider prefixes (aws_instance, azurerm_virtual_machine, etc.)
- **Navigation History**: Back/forward buttons to navigate through your exploration

### 🚀 **Productivity Features**

- **Copy Terraform Addresses**: Right-click to copy fully qualified resource addresses
- **Quick Search**: Find resources instantly in large Terraform projects
- **Multi-Provider Support**: Works with AWS, Azure, GCP, and all other Terraform providers
- **Performance Optimized**: Uses worker threads for large workspaces (500+ files)

## 🎯 **Perfect For**

- **DevOps Engineers** managing complex infrastructure
- **Platform Teams** working with large Terraform codebases
- **Cloud Architects** designing multi-service systems
- **Anyone** who wants to understand Terraform dependencies visually

## 📸 **Screenshots**

### Tree View Navigation

The extension provides two powerful ways to navigate your Terraform code:

**By File Structure** - Navigate your Terraform files just like in the file explorer, but with block counts:

```
📁 terraform-project
├── 📄 main.tf (8 blocks)
├── 📄 variables.tf (12 blocks)
└── 📁 modules (2 files)
    ├── 📁 networking (3 files)
    │   ├── 📄 main.tf (5 blocks)
    │   └── 📄 variables.tf (8 blocks)
    └── 📁 database (3 files)
        └── 📄 main.tf (4 blocks)
```

**By Resource Type** - Group resources by their type for better organization:

```
🏗️ Resources
├── 📦 aws_instance (3)
├── 🔒 aws_security_group (2)
├── 🌐 aws_vpc (1)
└── 🗄️ aws_db_instance (1)
🔧 Variables (12)
📤 Outputs (6)
📦 Modules (2)
```

### Interactive Dependency Graph

Visualize how your Terraform resources connect:

- **Nodes**: Represent resources, variables, modules, and outputs
- **Edges**: Show dependencies between components
- **Colors**: Provider-specific styling (AWS=Orange, Azure=Blue, etc.)
- **Navigation**: Click nodes to explore, use back/forward to navigate

## 🛠️ **Installation**

1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X)
3. Search for "Terraform Navigator"
4. Click Install

Or install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=owenrumney.tf-nav).

## 🎮 **Usage**

### Getting Started

1. Open any folder containing Terraform files (.tf or .tf.json)
2. The Terraform Navigator panel will appear in the sidebar
3. Click the 🔄 refresh button to build the initial index
   - The button will show "⏳ Refreshing..." while processing
   - Large projects may take a few moments to complete
4. Start exploring your infrastructure!

### View Modes

- **📁 File View**: Click the folder icon to browse by directory structure
- **🏷️ Type View**: Default view that groups resources by type
- **🔗 Graph View**: Click the link icon to open the interactive dependency graph

### Navigation

- **Single-click**: Select and highlight a resource
- **Double-click**: Jump to the resource definition in your code
- **Right-click**: Access context menu (copy address, show in graph, etc.)

### Dependency Graph

- **Click nodes**: Focus on specific resources and their immediate dependencies
- **Right-click nodes**: Reveal in editor, copy address, or focus dependencies
- **Back/Forward**: Navigate through your exploration history
- **Keyboard shortcuts**: Enter to reveal, Ctrl+C to copy selected node

## ⚙️ **Configuration**

Customize the extension in your VS Code settings:

```json
{
  // How to organize the tree view
  "tfnav.viewMode": "type", // "file" | "type"

  // Include data sources in the tree view
  "tfnav.includeDataSources": true,

  // Include .terraform directory (downloaded modules and providers)
  // ⚠️ WARNING: This can significantly impact performance in large projects
  "tfnav.includeTerraformCache": false,

  // Files/directories to ignore (supports glob patterns)
  "tfnav.ignore": [
    "**/.terraform/**",        // Excluded by default for performance
    "**/terraform.tfstate*",   // State files
    "**/.terragrunt-cache/**"  // Terragrunt cache
  ]
}
```

### 🗂️ **.terraform Directory Parsing**

The extension can optionally parse the `.terraform` directory, which contains:

- **Downloaded Modules**: Remote modules fetched during `terraform init`
- **Provider Plugins**: Downloaded provider binaries and schemas
- **Lock Files**: Dependency lock information

**🚨 Performance Impact**

Parsing `.terraform` directories can significantly slow down the extension, especially for:
- Projects with many remote modules
- Large provider schemas
- Complex dependency trees

**Recommendations:**
- ✅ **Keep disabled** (default) for daily development work
- ✅ **Enable temporarily** when you need to analyze downloaded module dependencies
- ✅ **Use with caution** in monorepos or large Terraform workspaces

**When to Enable:**
- Debugging module dependency issues
- Understanding how downloaded modules interact
- Analyzing the full dependency graph including external modules

**To Enable:**
```json
{
  "tfnav.includeTerraformCache": true
}
```

## 🚀 **Performance Features**

- **Smart Caching**: Parses only changed files for lightning-fast updates
- **Worker Threads**: Offloads parsing to background threads for large projects
- **Incremental Updates**: Only rebuilds what's necessary when files change
- **Memory Efficient**: LRU cache with automatic cleanup
- **Selective Parsing**: Excludes `.terraform` directories by default for optimal performance
- **Visual Feedback**: Refresh button shows loading state during index rebuilding

## 🔧 **Supported Terraform Features**

### Block Types

- ✅ Resources (`resource "aws_instance" "web"`)
- ✅ Data Sources (`data "aws_ami" "ubuntu"`)
- ✅ Modules (`module "vpc"`)
- ✅ Variables (`variable "region"`)
- ✅ Outputs (`output "instance_ip"`)
- ✅ Locals (`locals { ... }`)

### File Types

- ✅ `.tf` files (HCL syntax)
- ✅ `.tf.json` files (JSON syntax)

### Providers

- ✅ AWS, Azure, Google Cloud Platform
- ✅ Kubernetes, Docker, Helm
- ✅ GitHub, GitLab, Datadog
- ✅ All community providers

## 🤝 **Contributing**

Found a bug or have a feature request?

- 🐛 **Report Issues**: [GitHub Issues](https://github.com/owenrumney/tf-nav/issues)
- 💡 **Feature Requests**: [GitHub Discussions](https://github.com/owenrumney/tf-nav/discussions)
- ⭐ **Star the Project**: [GitHub Repository](https://github.com/owenrumney/tf-nav)

## 📄 **License**

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🏷️ **Keywords**

terraform, infrastructure, devops, aws, azure, gcp, navigation, dependency, graph, visualization, hcl, infrastructure-as-code
