/**
 * Module resolver for Terraform modules
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Result of resolving a module source
 */
export interface ModuleResolution {
  /** Whether the module was successfully resolved */
  resolved: boolean;

  /** Absolute path to the module directory (if resolved) */
  modulePath?: string;

  /** Type of resolution (local, registry, git, etc.) */
  resolutionType: 'local' | 'registry' | 'git' | 'terraform_registry' | 'unknown';

  /** Error message if resolution failed */
  error?: string;
}

/**
 * Resolve a Terraform module source to a local directory
 * @param source The source string from the module block
 * @param baseDir The directory containing the module block
 * @returns Resolution result
 */
export function resolveModuleSource(source: string, baseDir: string): ModuleResolution {
  console.log(`[ModuleResolver] Resolving module source: "${source}" from baseDir: ${baseDir}`);
  
  // Handle local paths (relative or absolute)
  if (source.startsWith('./') || source.startsWith('../') || source.startsWith('/')) {
    console.log(`[ModuleResolver] Treating as local path: ${source}`);
    try {
      const resolvedPath = path.resolve(baseDir, source);
      console.log(`[ModuleResolver] Resolved local path to: ${resolvedPath}`);

      if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()) {
        console.log(`[ModuleResolver] Local path exists and is directory`);
        return {
          resolved: true,
          modulePath: resolvedPath,
          resolutionType: 'local',
        };
      } else {
        console.log(`[ModuleResolver] Local path does not exist or is not directory`);
        return {
          resolved: false,
          resolutionType: 'local',
          error: `Module directory does not exist: ${resolvedPath}`,
        };
      }
    } catch (error) {
      console.log(`[ModuleResolver] Error resolving local path: ${error}`);
      return {
        resolved: false,
        resolutionType: 'local',
        error: `Failed to resolve local path: ${error}`,
      };
    }
  }

  // Try to resolve using Terraform's module cache (.terraform/modules)
  console.log(`[ModuleResolver] Trying Terraform module cache for: ${source}`);
  const terraformModulePath = resolveTerraformModuleCache(source, baseDir);
  if (terraformModulePath) {
    console.log(`[ModuleResolver] Found in Terraform cache: ${terraformModulePath.modulePath}`);
    return terraformModulePath;
  }
  console.log(`[ModuleResolver] Not found in Terraform cache`);

  // Handle Terraform Registry modules (e.g., "hashicorp/consul/aws")
  if (source.includes('/') && !source.includes('://')) {
    console.log(`[ModuleResolver] Treating as registry module: ${source}`);
    // This is a registry module, but we can't resolve it locally
    return {
      resolved: false,
      resolutionType: 'registry',
      error: 'Registry modules cannot be resolved locally without terraform init',
    };
  }

  // Handle Git sources (e.g., "git::https://github.com/example/repo.git")
  if (source.startsWith('git::') || source.includes('://')) {
    console.log(`[ModuleResolver] Treating as git module: ${source}`);
    return {
      resolved: false,
      resolutionType: 'git',
      error: 'Git modules cannot be resolved locally without terraform init',
    };
  }

  // Unknown source format
  console.log(`[ModuleResolver] Unknown source format: ${source}`);
  return {
    resolved: false,
    resolutionType: 'unknown',
    error: `Unknown module source format: ${source}`,
  };
}

/**
 * Interface for Terraform modules.json file structure
 */
interface TerraformModulesManifest {
  Modules: Array<{
    Key: string;
    Source: string;
    Dir: string;
    Version?: string;
  }>;
}

/**
 * Resolve module using Terraform's module cache (.terraform/modules)
 * @param source The module source string
 * @param baseDir The directory containing the module block
 * @returns Resolution result or null if not found
 */
function resolveTerraformModuleCache(source: string, baseDir: string): ModuleResolution | null {
  console.log(`[ModuleResolver] Looking for .terraform directory starting from: ${baseDir}`);
  
  // Find the nearest .terraform directory (walk up from baseDir)
  let currentDir = baseDir;
  let terraformDir: string | null = null;

  while (currentDir !== path.dirname(currentDir)) { // Stop at filesystem root
    const potentialTerraformDir = path.join(currentDir, '.terraform');
    console.log(`[ModuleResolver] Checking for .terraform at: ${potentialTerraformDir}`);
    
    if (fs.existsSync(potentialTerraformDir) && fs.statSync(potentialTerraformDir).isDirectory()) {
      terraformDir = potentialTerraformDir;
      console.log(`[ModuleResolver] Found .terraform directory: ${terraformDir}`);
      break;
    }
    currentDir = path.dirname(currentDir);
  }

  if (!terraformDir) {
    console.log(`[ModuleResolver] No .terraform directory found`);
    return null; // No .terraform directory found
  }

  const modulesJsonPath = path.join(terraformDir, 'modules', 'modules.json');
  console.log(`[ModuleResolver] Looking for modules.json at: ${modulesJsonPath}`);
  
  try {
    if (!fs.existsSync(modulesJsonPath)) {
      console.log(`[ModuleResolver] modules.json not found`);
      return null; // No modules.json file
    }

    console.log(`[ModuleResolver] Reading modules.json`);
    const modulesJsonContent = fs.readFileSync(modulesJsonPath, 'utf-8');
    const manifest: TerraformModulesManifest = JSON.parse(modulesJsonContent);

    console.log(`[ModuleResolver] Found ${manifest.Modules.length} modules in manifest`);
    for (const module of manifest.Modules) {
      console.log(`  - Key: "${module.Key}", Source: "${module.Source}", Dir: "${module.Dir}"`);
    }

    // Find the module in the manifest
    // The Key field typically matches the source, but we need to handle variations
    for (const module of manifest.Modules) {
      if (module.Source === source || module.Key === source) {
        const modulePath = path.resolve(terraformDir, 'modules', module.Dir);
        console.log(`[ModuleResolver] Found matching module, checking path: ${modulePath}`);
        
        if (fs.existsSync(modulePath) && fs.statSync(modulePath).isDirectory()) {
          console.log(`[ModuleResolver] Module path exists and is directory`);
          return {
            resolved: true,
            modulePath,
            resolutionType: module.Source.includes('://') ? 'git' : 
                          module.Source.includes('/') ? 'registry' : 'local',
          };
        } else {
          console.log(`[ModuleResolver] Module path does not exist or is not directory`);
        }
      }
    }

    console.log(`[ModuleResolver] No matching module found in manifest for source: ${source}`);
    return null; // Module not found in manifest
  } catch (error) {
    console.warn(`[ModuleResolver] Failed to read Terraform modules manifest: ${error}`);
    return null;
  }
}

/**
 * Find all Terraform files in a module directory
 * @param modulePath Absolute path to the module directory
 * @returns Array of Terraform file paths
 */
export function findModuleFiles(modulePath: string): string[] {
  const files: string[] = [];

  function scanDirectory(dir: string) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          // Skip .terraform directory and other common non-module directories
          if (!['.terraform', '.git', 'node_modules'].includes(entry.name)) {
            scanDirectory(fullPath);
          }
        } else if (entry.isFile()) {
          // Include common Terraform file extensions
          if (['.tf', '.tf.json'].includes(path.extname(entry.name))) {
            files.push(fullPath);
          }
        }
      }
    } catch (error) {
      console.warn(`Failed to scan directory ${dir}:`, error);
    }
  }

  scanDirectory(modulePath);
  return files;
}