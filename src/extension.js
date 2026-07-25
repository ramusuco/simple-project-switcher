const vscode = require('vscode');

const CONFIG_SECTION = 'simpleProjectSwitcher';
const PROJECTS_SETTING = 'projects';

class ProjectStore {
  getAll() {
    const projects = vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .get(PROJECTS_SETTING, []);
    if (!Array.isArray(projects)) {
      return [];
    }

    return projects
      .filter(
        (project) =>
          project &&
          typeof project.name === 'string' &&
          typeof project.path === 'string',
      )
      .map((project) => ({
        name: project.name,
        path: project.path,
        group: typeof project.group === 'string' ? project.group : '',
      }));
  }

  async save(projects) {
    await vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .update(PROJECTS_SETTING, projects, vscode.ConfigurationTarget.Global);
  }

  async add(project) {
    await this.save([...this.getAll(), project]);
  }

  async update(originalPath, project) {
    const projects = this.getAll().map((saved) =>
      saved.path === originalPath ? project : saved,
    );
    await this.save(projects);
  }

  async remove(path) {
    const projects = this.getAll().filter((project) => project.path !== path);
    await this.save(projects);
  }
}

class ProjectGroup {
  constructor(name, projects) {
    this.name = name;
    this.projects = projects;
  }
}

class ProjectTreeProvider {
  constructor(store) {
    this.store = store;
    this.changeEmitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.changeEmitter.event;
  }

  refresh() {
    this.changeEmitter.fire(undefined);
  }

  getTreeItem(element) {
    if (element instanceof ProjectGroup) {
      const item = new vscode.TreeItem(
        element.name,
        vscode.TreeItemCollapsibleState.Expanded,
      );
      item.contextValue = 'group';
      item.iconPath = new vscode.ThemeIcon('folder-library');
      return item;
    }

    const project = element;
    const uri = projectUri(project);
    const item = new vscode.TreeItem(
      project.name,
      vscode.TreeItemCollapsibleState.None,
    );

    item.id = `project:${project.path}`;
    item.description = displayUri(uri);
    item.tooltip = [project.name, project.group, displayUri(uri)]
      .filter(Boolean)
      .join('\n');
    item.iconPath = new vscode.ThemeIcon(
      isWorkspaceFile(uri) ? 'window' : 'folder',
    );
    item.contextValue = 'project';
    item.command = {
      command: 'simpleProjectSwitcher.open',
      title: 'Open Project',
      arguments: [project],
    };

    return item;
  }

  getChildren(element) {
    if (element instanceof ProjectGroup) {
      return sortProjects(element.projects);
    }

    if (element) {
      return [];
    }

    const projects = this.store.getAll();
    const grouped = new Map();
    const ungrouped = [];

    for (const project of projects) {
      const group = project.group.trim();
      if (!group) {
        ungrouped.push(project);
        continue;
      }

      const entries = grouped.get(group) || [];
      entries.push(project);
      grouped.set(group, entries);
    }

    const groups = [...grouped.entries()]
      .sort(([left], [right]) => compareNames(left, right))
      .map(([name, entries]) => new ProjectGroup(name, entries));

    return [...groups, ...sortProjects(ungrouped)];
  }

  dispose() {
    this.changeEmitter.dispose();
  }
}

function compareNames(left, right) {
  return left.localeCompare(right, undefined, { sensitivity: 'base' });
}

function sortProjects(projects) {
  return [...projects].sort((left, right) =>
    compareNames(left.name, right.name),
  );
}

function projectUri(project) {
  return parseLocation(project.path);
}

function displayUri(uri) {
  return uri.scheme === 'file' ? uri.fsPath : uri.toString(true);
}

function isWorkspaceFile(uri) {
  return uri.path.toLowerCase().endsWith('.code-workspace');
}

function parseLocation(value) {
  const location = value.trim();
  if (
    /^[a-zA-Z]:[\\/]/.test(location) ||
    location.startsWith('\\\\') ||
    location.startsWith('/')
  ) {
    return vscode.Uri.file(location);
  }

  const uri = vscode.Uri.parse(location, true);
  return uri.scheme ? uri : vscode.Uri.file(location);
}

function defaultProjectName(uri) {
  const lastSegment = uri.path.split('/').filter(Boolean).at(-1) || 'Project';
  return decodeURIComponent(lastSegment).replace(/\.code-workspace$/i, '');
}

function storedPath(uri) {
  return uri.scheme === 'file' ? uri.fsPath : uri.toString(true);
}

function currentProjectTarget() {
  const workspaceFile = vscode.workspace.workspaceFile;
  if (workspaceFile && workspaceFile.scheme !== 'untitled') {
    return workspaceFile;
  }

  const folders = vscode.workspace.workspaceFolders || [];
  return folders.length === 1 ? folders[0].uri : undefined;
}

async function projectExists(uri) {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if ((stat.type & vscode.FileType.Directory) !== 0) {
      return true;
    }

    return (
      (stat.type & vscode.FileType.File) !== 0 && isWorkspaceFile(uri)
    );
  } catch {
    return false;
  }
}

async function pickProject(store, placeHolder) {
  const projects = store.getAll();
  if (projects.length === 0) {
    void vscode.window.showInformationMessage('No saved projects.');
    return undefined;
  }

  const selected = await vscode.window.showQuickPick(
    projects.map((project) => ({
      label: project.name,
      description: [project.group, displayUri(projectUri(project))]
        .filter(Boolean)
        .join(' - '),
      project,
    })),
    { placeHolder },
  );

  return selected?.project;
}

async function resolveProject(store, project, placeHolder) {
  return project?.path ? project : pickProject(store, placeHolder);
}

function existingGroups(store) {
  const groups = new Map();

  for (const project of store.getAll()) {
    const group = project.group.trim();
    const key = group.toLocaleLowerCase();
    if (group && !groups.has(key)) {
      groups.set(key, group);
    }
  }

  return [...groups.values()].sort(compareNames);
}

async function chooseGroup(store, currentGroup = '') {
  const groups = existingGroups(store);
  if (groups.length === 0) {
    const group = await vscode.window.showInputBox({
      prompt: 'Group (optional)',
      placeHolder: 'Frontend',
      value: currentGroup,
    });
    return group === undefined ? undefined : group.trim();
  }

  const selected = await vscode.window.showQuickPick(
    [
      ...groups.map((group) => ({ label: group, group })),
      {
        label: 'No group',
        description: 'Leave this project ungrouped',
        group: '',
      },
      {
        label: 'Create new group...',
        description: 'Enter a group name',
        create: true,
      },
    ],
    {
      title: 'Group',
      placeHolder: 'Select an existing group or create a new one',
      matchOnDescription: true,
    },
  );

  if (!selected) {
    return undefined;
  }

  if (!selected.create) {
    return selected.group;
  }

  const group = await vscode.window.showInputBox({
    prompt: 'New group name',
    placeHolder: 'Frontend',
  });
  return group === undefined ? undefined : group.trim();
}

async function addProject(store, provider, uri, suggestedName) {
  if (!(await projectExists(uri))) {
    void vscode.window.showErrorMessage(
      'Select an existing folder or .code-workspace file.',
    );
    return;
  }

  const path = storedPath(uri);
  if (store.getAll().some((project) => project.path === path)) {
    void vscode.window.showInformationMessage('This project is already saved.');
    return;
  }

  const name = await vscode.window.showInputBox({
    prompt: 'Project name',
    value: suggestedName,
    validateInput: (value) => (value.trim() ? undefined : 'Enter a name.'),
  });

  if (name === undefined) {
    return;
  }

  const group = await chooseGroup(store);
  if (group === undefined) {
    return;
  }

  await store.add({
    name: name.trim(),
    path,
    group: group.trim(),
  });
  provider.refresh();
}

async function saveCurrentProject(store, provider) {
  const uri = currentProjectTarget();
  if (!uri) {
    void vscode.window.showErrorMessage(
      'Open one folder or save the current workspace before adding it.',
    );
    return;
  }

  await addProject(
    store,
    provider,
    uri,
    vscode.workspace.name || defaultProjectName(uri),
  );
}

async function addProjectFromDisk(store, provider) {
  const selected = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Add Project',
    filters: {
      'VS Code Workspace': ['code-workspace'],
    },
  });
  const uri = selected?.[0];
  if (!uri) {
    return;
  }

  await addProject(store, provider, uri, defaultProjectName(uri));
}

async function editProject(store, provider, project) {
  const selected = await resolveProject(store, project, 'Select a project to edit');
  if (!selected) {
    return;
  }

  const name = await vscode.window.showInputBox({
    prompt: 'Project name',
    value: selected.name,
    validateInput: (value) => (value.trim() ? undefined : 'Enter a name.'),
  });
  if (name === undefined) {
    return;
  }

  const group = await chooseGroup(store, selected.group);
  if (group === undefined) {
    return;
  }

  await store.update(selected.path, {
    ...selected,
    name: name.trim(),
    group: group.trim(),
  });
  provider.refresh();
}

async function deleteProject(store, provider, project) {
  const selected = await resolveProject(
    store,
    project,
    'Select a project to delete',
  );
  if (!selected) {
    return;
  }

  const confirmation = await vscode.window.showWarningMessage(
    `Delete "${selected.name}" from the project list?`,
    { modal: true },
    'Delete',
  );
  if (confirmation !== 'Delete') {
    return;
  }

  await store.remove(selected.path);
  provider.refresh();
}

async function openProject(store, project, newWindow) {
  const selected = await resolveProject(
    store,
    project,
    newWindow ? 'Open project in a new window' : 'Open project',
  );
  if (!selected) {
    return;
  }

  const uri = projectUri(selected);
  if (!(await projectExists(uri))) {
    void vscode.window.showErrorMessage(
      `Project location does not exist: ${displayUri(uri)}`,
    );
    return;
  }

  await vscode.commands.executeCommand(
    'vscode.openFolder',
    uri,
    newWindow ? { forceNewWindow: true } : { forceReuseWindow: true },
  );
}

async function reportErrors(action) {
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(message);
  }
}

function activate(context) {
  const store = new ProjectStore();
  const provider = new ProjectTreeProvider(store);
  const treeView = vscode.window.createTreeView(
    'simpleProjectSwitcher.projects',
    { treeDataProvider: provider },
  );

  const register = (id, handler) =>
    vscode.commands.registerCommand(id, (...args) =>
      reportErrors(() => handler(...args)),
    );

  context.subscriptions.push(
    provider,
    treeView,
    register('simpleProjectSwitcher.saveCurrent', () =>
      saveCurrentProject(store, provider),
    ),
    register('simpleProjectSwitcher.addFromDisk', () =>
      addProjectFromDisk(store, provider),
    ),
    register('simpleProjectSwitcher.edit', (project) =>
      editProject(store, provider, project),
    ),
    register('simpleProjectSwitcher.delete', (project) =>
      deleteProject(store, provider, project),
    ),
    register('simpleProjectSwitcher.open', (project) =>
      openProject(store, project, false),
    ),
    register('simpleProjectSwitcher.openNewWindow', (project) =>
      openProject(store, project, true),
    ),
    register('simpleProjectSwitcher.openSettingsJson', () =>
      vscode.commands.executeCommand('workbench.action.openSettingsJson'),
    ),
    register('simpleProjectSwitcher.refresh', () => provider.refresh()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(`${CONFIG_SECTION}.${PROJECTS_SETTING}`)) {
        provider.refresh();
      }
    }),
  );
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
