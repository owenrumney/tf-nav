tf-nav: Terraform Navigator VSCode Extension

Design Document & Requirements Specification

⸻

1. Overview

tf-nav is a Visual Studio Code extension that provides a structured tree view of Terraform configurations. Instead of manually searching .tf files for resources, data sources, and modules, users can browse their infrastructure in a hierarchical tree.

The extension will initially support two navigation modes:
• By File → View resources grouped by the file they are defined in.
• By Resource Type → View resources grouped by type (e.g., aws_security_group, aws_instance).

A future enhancement (v2) will add an optional Graph View, allowing users to explore dependencies between resources.

⸻

2. Goals
   • Improve discoverability of Terraform resources in large codebases.
   • Provide quick navigation from tree to source code.
   • Give infrastructure engineers a mental map of resources without relying solely on search.
   • Lay groundwork for visual dependency exploration.

⸻

3. Non-Goals (v1)
   • State visualization (terraform show, terraform state list).
   • Plan/diff visualization.
   • Terragrunt support.
   • Graph rendering (deferred to v2).

⸻

4. Requirements

4.1 Functional Requirements (v1) 1. Tree View
• Provide a VSCode tree view called Terraform Navigator.
• Two modes (configurable via settings):
• By File
• By Resource Type 2. Supported Blocks
• Resources (resource)
• Data sources (data)
• Modules (module)
• Variables (variable)
• Outputs (output)
• Locals (locals) 3. Tree Node Actions
• Reveal in Editor: open the file and jump to the block definition.
• Copy Terraform Address: copy fully qualified address (e.g., module.vpc.aws_security_group.web_sg). 4. Indexing
• Parse .tf and .tf.json files in workspace.
• Maintain an index of blocks (resource type, name, file, range, module path).
• Automatically refresh on file changes. 5. Configuration (settings.json)
• tfnav.viewMode: "file" | "type" (default: "type")
• tfnav.includeDataSources: boolean (default: true)
• tfnav.ignore: glob patterns (default: ["**/.terraform/**"]) 6. Performance
• Initial index for ~200 .tf files in < 1 second.
• Incremental update after file save in < 200 ms.

⸻

4.2 Stretch Requirements (v2) 1. Graph View
• Visualize dependencies between resources.
• Expand/collapse nodes dynamically.
• Show inbound/outbound references.
• Provide a toggle between static (parsed refs) and plan-aware (terraform show -json) modes. 2. Quick Pick Search
• Command palette: “Find Terraform Resource” → type-ahead search across resources. 3. Enhanced Tooltips
• Show provider alias, module path, and count of references.

⸻

5. Architecture

5.1 High-Level Components
• Indexer
• Scans .tf and .tf.json files.
• Parses blocks, extracts metadata (type, name, file, range, module path).
• Builds lookup maps: byType, byFile.
• Emits incremental updates on file changes.
• TreeDataProvider
• Implements VSCode TreeDataProvider<T>.
• Reads from index to render tree.
• Supports two modes (by file, by type).
• Commands
• tfnav.refreshIndex
• tfnav.reveal
• tfnav.copyAddress
• tfnav.switchViewMode
• Config
• Read extension settings (see Section 4.1.5).
• Graph Module (v2)
• Uses dependency edges extracted from expressions.
• Renders with Cytoscape.js inside a VSCode Webview.

⸻

5.2 Data Model

Address:
• blockType: "resource" | "data" | "module" | "variable" | "output" | "locals"
• provider?: string (e.g. "aws")
• kind?: string (e.g. "aws_security_group")
• name?: string (e.g. "web_sg")
• modulePath: string[] (e.g. ["module.vpc", "module.db"])
• file: string (absolute file path)
• range: { start: number; end: number }

ProjectIndex:
• blocks: Address[]
• byType: Map<string, Address[]>
• byFile: Map<string, Address[]>
• refs?: Edge[] (for v2)

Edge:
• from: string (terraform address)
• to: string (terraform address)
• attr?: string (attribute that caused reference)

⸻

6. Technical Notes

6.1 Parsing
• Start with a Node HCL2 parser (@opticdev/hcl or hcl2-parser).
• If limitations appear, introduce a Go helper using hashicorp/hcl/v2 compiled to binary/WASM.

6.2 Incremental Updates
• Use VSCode file watcher (workspace.onDidSaveTextDocument).
• Debounce events (~250ms).
• Reparse only changed file, update index maps.

6.3 Performance
• Use a worker thread for parsing if workspace > 500 files.
• Cache results keyed by (path, mtime, size).

6.4 Testing
• Fixture repos: AWS, Azure, GCP Terraform examples.
• Synthetic configs with complex expressions (for_each, dynamic, heredoc, ternary).
• Target <500ms index time on 200 files.

⸻

7. UX Mockups (textual)

By Type
aws_security_group
web_sg (module: root) [vpc/sg.tf:12]
db_sg (module: module.vpc)
aws_instance
web[0]
web[1]

By File
vpc/sg.tf
resource.aws_security_group.web_sg
resource.aws_security_group.db_sg
app/compute.tf
resource.aws_instance.web[0]
resource.aws_instance.web[1]

⸻

8. Milestones

v1 (Tree-based navigation)
• Scaffold extension (activate, TreeDataProvider, commands).
• Implement file discovery + parser integration.
• Build ProjectIndex.
• Implement “By Type” + “By File” trees.
• Implement “Reveal in Editor” + “Copy Address”.
• Config settings.
• Publish preview version on VSCode marketplace.

v2 (Graph + advanced features)
• Expression traversal → dependency edges.
• Optional terraform show -json integration.
• Graph rendering (Cytoscape.js webview).
• Quick Pick “Find Resource”.
• Enhanced tooltips + provider alias display.

⸻

9. Risks & Mitigations
   • Parser fidelity: HCL edge cases may break indexer.
   → Mitigation: fallback to Go-based parser if necessary.
   • Large repos: Could hit performance issues.
   → Mitigation: incremental parsing, caching, worker threads.
   • Feature creep: Graph complexity.
   → Mitigation: defer to v2, keep v1 lightweight.
