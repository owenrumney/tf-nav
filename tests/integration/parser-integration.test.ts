// Integration tests for parser with real Terraform files
import { TerraformParserFactory } from '../../src/indexer/parser';
import { createTestWorkspaceHelper } from '../test-utils';
import * as fs from 'fs';
import * as path from 'path';

describe('Parser Integration Tests', () => {
  const testWorkspace = createTestWorkspaceHelper();
  
  beforeAll(() => {
    const validation = testWorkspace.validateWorkspace();
    if (!validation.isValid) {
      throw new Error(`Test workspace validation failed: ${validation.errors.join(', ')}`);
    }
  });

  it('should parse main.tf from test workspace', async () => {
    const mainTfPath = path.join(__dirname, '..', 'workspace', 'main.tf');
    const content = fs.readFileSync(mainTfPath, 'utf-8');
    
    const result = await TerraformParserFactory.parseFile(mainTfPath, content);
    
    expect(result.errors).toHaveLength(0);
    expect(result.blocks.length).toBeGreaterThan(0);
    
    // Should find AWS resources
    const awsResources = result.blocks.filter(b => b.blockType === 'resource' && b.provider === 'aws');
    expect(awsResources.length).toBeGreaterThan(0);
    
    // Should find modules
    const modules = result.blocks.filter(b => b.blockType === 'module');
    expect(modules.length).toBeGreaterThan(0);
    
    // Check specific resources we expect
    const vpc = result.blocks.find(b => b.kind === 'aws_vpc' && b.name === 'main');
    expect(vpc).toBeDefined();
    expect(vpc?.blockType).toBe('resource');
    expect(vpc?.provider).toBe('aws');
    
    const dbModule = result.blocks.find(b => b.blockType === 'module' && b.name === 'database');
    expect(dbModule).toBeDefined();
  });

  it('should parse variables.tf from test workspace', async () => {
    const variablesTfPath = path.join(__dirname, '..', 'workspace', 'variables.tf');
    const content = fs.readFileSync(variablesTfPath, 'utf-8');
    
    const result = await TerraformParserFactory.parseFile(variablesTfPath, content);
    
    expect(result.errors).toHaveLength(0);
    expect(result.blocks.length).toBeGreaterThan(0);
    
    // All blocks should be variables
    const variables = result.blocks.filter(b => b.blockType === 'variable');
    expect(variables.length).toBe(result.blocks.length);
    expect(variables.length).toBeGreaterThan(0);
    
    // Check for specific variables we expect
    const projectName = result.blocks.find(b => b.name === 'project_name');
    expect(projectName).toBeDefined();
    expect(projectName?.blockType).toBe('variable');
    
    const region = result.blocks.find(b => b.name === 'region');
    expect(region).toBeDefined();
  });

  it('should parse data.tf from test workspace', async () => {
    const dataTfPath = path.join(__dirname, '..', 'workspace', 'data.tf');
    const content = fs.readFileSync(dataTfPath, 'utf-8');
    
    const result = await TerraformParserFactory.parseFile(dataTfPath, content);
    
    expect(result.errors).toHaveLength(0);
    expect(result.blocks.length).toBeGreaterThan(0);
    
    // All blocks should be data sources
    const dataSources = result.blocks.filter(b => b.blockType === 'data');
    expect(dataSources.length).toBe(result.blocks.length);
    expect(dataSources.length).toBeGreaterThan(0);
    
    // Check for specific data sources
    const callerIdentity = result.blocks.find(b => b.kind === 'aws_caller_identity');
    expect(callerIdentity).toBeDefined();
    expect(callerIdentity?.provider).toBe('aws');
    
    const ubuntuAmi = result.blocks.find(b => b.kind === 'aws_ami' && b.name === 'ubuntu');
    expect(ubuntuAmi).toBeDefined();
  });

  it('should parse outputs.tf from test workspace', async () => {
    const outputsTfPath = path.join(__dirname, '..', 'workspace', 'outputs.tf');
    const content = fs.readFileSync(outputsTfPath, 'utf-8');
    
    const result = await TerraformParserFactory.parseFile(outputsTfPath, content);
    
    expect(result.errors).toHaveLength(0);
    expect(result.blocks.length).toBeGreaterThan(0);
    
    // All blocks should be outputs
    const outputs = result.blocks.filter(b => b.blockType === 'output');
    expect(outputs.length).toBe(result.blocks.length);
    expect(outputs.length).toBeGreaterThan(0);
    
    // Check for specific outputs
    const vpcId = result.blocks.find(b => b.name === 'vpc_id');
    expect(vpcId).toBeDefined();
    expect(vpcId?.blockType).toBe('output');
  });

  it('should parse locals.tf from test workspace', async () => {
    const localsTfPath = path.join(__dirname, '..', 'workspace', 'locals.tf');
    const content = fs.readFileSync(localsTfPath, 'utf-8');
    
    const result = await TerraformParserFactory.parseFile(localsTfPath, content);
    
    expect(result.errors).toHaveLength(0);
    expect(result.blocks.length).toBeGreaterThan(0);
    
    // Should find locals block
    const locals = result.blocks.find(b => b.blockType === 'locals');
    expect(locals).toBeDefined();
  });

  it('should parse s3.tf.json from test workspace', async () => {
    const s3JsonPath = path.join(__dirname, '..', 'workspace', 's3.tf.json');
    const content = fs.readFileSync(s3JsonPath, 'utf-8');
    
    const result = await TerraformParserFactory.parseFile(s3JsonPath, content);
    
    expect(result.errors).toHaveLength(0);
    expect(result.blocks.length).toBeGreaterThan(0);
    
    // Should find resources and variables
    const resources = result.blocks.filter(b => b.blockType === 'resource');
    const variables = result.blocks.filter(b => b.blockType === 'variable');
    
    expect(resources.length).toBeGreaterThan(0);
    expect(variables.length).toBeGreaterThan(0);
    
    // Check specific resource
    const s3Bucket = result.blocks.find(b => b.kind === 'aws_s3_bucket');
    expect(s3Bucket).toBeDefined();
    expect(s3Bucket?.provider).toBe('aws');
  });

  it('should parse module files from test workspace', async () => {
    const rdsMainPath = path.join(__dirname, '..', 'workspace', 'modules', 'rds', 'main.tf');
    const content = fs.readFileSync(rdsMainPath, 'utf-8');
    
    const result = await TerraformParserFactory.parseFile(rdsMainPath, content, {
      modulePath: ['module.database']
    });
    
    expect(result.errors).toHaveLength(0);
    expect(result.blocks.length).toBeGreaterThan(0);
    
    // All blocks should have the module path
    result.blocks.forEach(block => {
      expect(block.modulePath).toEqual(['module.database']);
    });
    
    // Should find RDS resources
    const dbInstance = result.blocks.find(b => b.kind === 'aws_db_instance');
    expect(dbInstance).toBeDefined();
    expect(dbInstance?.provider).toBe('aws');
    
    const dbSubnetGroup = result.blocks.find(b => b.kind === 'aws_db_subnet_group');
    expect(dbSubnetGroup).toBeDefined();
  });

  it('should handle all block types correctly', async () => {
    const allFiles = [
      'main.tf',
      'variables.tf', 
      'data.tf',
      'outputs.tf',
      'locals.tf',
      's3.tf.json'
    ];
    
    let totalBlocks = 0;
    const blockTypeCounts = new Map<string, number>();
    
    for (const fileName of allFiles) {
      const filePath = path.join(__dirname, '..', 'workspace', fileName);
      const content = fs.readFileSync(filePath, 'utf-8');
      
      const result = await TerraformParserFactory.parseFile(filePath, content);
      
      expect(result.errors).toHaveLength(0);
      totalBlocks += result.blocks.length;
      
      result.blocks.forEach(block => {
        const count = blockTypeCounts.get(block.blockType) || 0;
        blockTypeCounts.set(block.blockType, count + 1);
      });
    }
    
    expect(totalBlocks).toBeGreaterThan(0);
    
    // Should have found all block types
    expect(blockTypeCounts.has('resource')).toBe(true);
    expect(blockTypeCounts.has('data')).toBe(true);
    expect(blockTypeCounts.has('module')).toBe(true);
    expect(blockTypeCounts.has('variable')).toBe(true);
    expect(blockTypeCounts.has('output')).toBe(true);
    expect(blockTypeCounts.has('locals')).toBe(true);
    
    console.log('Block type counts:', Object.fromEntries(blockTypeCounts));
    console.log('Total blocks parsed:', totalBlocks);
  });
});
