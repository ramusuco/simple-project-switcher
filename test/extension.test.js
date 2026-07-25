const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

test('stores projects in settings and groups them in the tree', async () => {
  const commandHandlers = new Map();
  const inputResponses = [];
  const dialogResponses = [];
  const quickPickResponses = [];
  const warningResponses = [];
  const openedFolders = [];
  const errors = [];
  let settingsOpened = false;
  let configuredProjects = [];
  let provider;

  class EventEmitter {
    constructor() {
      this.event = () => {};
    }

    fire() {}

    dispose() {}
  }

  class TreeItem {
    constructor(label, collapsibleState) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  }

  class ThemeIcon {
    constructor(id) {
      this.id = id;
    }
  }

  class Uri {
    constructor(scheme, fsPath, path, value) {
      this.scheme = scheme;
      this.fsPath = fsPath;
      this.path = path;
      this.value = value;
    }

    static file(fsPath) {
      const normalized = fsPath.replace(/\\/g, '/');
      const uriPath = /^[a-zA-Z]:\//.test(normalized)
        ? `/${normalized}`
        : normalized;
      return new Uri('file', fsPath, uriPath, `file://${uriPath}`);
    }

    static parse(value) {
      if (value.startsWith('file://')) {
        const path = value.slice('file://'.length);
        const fsPath = path
          .replace(/^\/([a-zA-Z]:\/)/, '$1')
          .replace(/\//g, '\\');
        return new Uri('file', fsPath, path, value);
      }

      const scheme = value.split(':', 1)[0];
      const path = value.slice(scheme.length + 1);
      return new Uri(scheme, '', path, value);
    }

    toString() {
      return this.value;
    }
  }

  const currentUri = Uri.file('C:\\work\\alpha');
  const vscodeMock = {
    ConfigurationTarget: { Global: 1 },
    EventEmitter,
    TreeItem,
    ThemeIcon,
    Uri,
    TreeItemCollapsibleState: { None: 0, Expanded: 2 },
    FileType: { File: 1, Directory: 2 },
    workspace: {
      name: 'alpha',
      workspaceFile: undefined,
      workspaceFolders: [{ uri: currentUri }],
      fs: {
        stat: async () => ({ type: 2 }),
      },
      getConfiguration: () => ({
        get: (_key, defaultValue) => configuredProjects || defaultValue,
        update: async (_key, value, target) => {
          assert.equal(target, 1);
          configuredProjects = value;
        },
      }),
      onDidChangeConfiguration: () => ({ dispose() {} }),
    },
    commands: {
      registerCommand: (id, handler) => {
        commandHandlers.set(id, handler);
        return { dispose() {} };
      },
      executeCommand: async (id, ...args) => {
        if (id === 'vscode.openFolder') {
          openedFolders.push(args);
          return;
        }

        if (id === 'workbench.action.openSettingsJson') {
          settingsOpened = true;
          return;
        }

        return commandHandlers.get(id)?.(...args);
      },
    },
    window: {
      createTreeView: (_id, options) => {
        provider = options.treeDataProvider;
        return { dispose() {} };
      },
      showInputBox: async () => inputResponses.shift(),
      showOpenDialog: async () => dialogResponses.shift(),
      showQuickPick: async (items) => {
        const response = quickPickResponses.shift();
        return typeof response === 'function' ? response(items) : response;
      },
      showWarningMessage: async () => warningResponses.shift(),
      showInformationMessage: () => {},
      showErrorMessage: (message) => {
        errors.push(message);
      },
    },
  };

  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    return request === 'vscode'
      ? vscodeMock
      : originalLoad.call(this, request, parent, isMain);
  };

  try {
    const extension = require('../src/extension.js');
    const context = { subscriptions: [] };

    extension.activate(context);

    inputResponses.push('Alpha', 'Frontend');
    await commandHandlers.get('simpleProjectSwitcher.saveCurrent')();

    assert.deepEqual(configuredProjects, [
      {
        name: 'Alpha',
        path: 'C:\\work\\alpha',
        group: 'Frontend',
      },
    ]);

    let roots = provider.getChildren();
    assert.equal(roots.length, 1);
    assert.equal(provider.getTreeItem(roots[0]).label, 'Frontend');

    let projects = provider.getChildren(roots[0]);
    assert.equal(projects.length, 1);
    assert.equal(projects[0].name, 'Alpha');
    assert.equal(provider.getTreeItem(projects[0]).contextValue, 'project');

    dialogResponses.push([Uri.file('C:\\work\\beta')]);
    inputResponses.push('Beta');
    quickPickResponses.push((items) =>
      items.find((item) => item.group === 'Frontend'),
    );
    await commandHandlers.get('simpleProjectSwitcher.addFromDisk')();

    roots = provider.getChildren();
    projects = provider.getChildren(roots[0]);
    assert.deepEqual(
      projects.map((project) => project.name),
      ['Alpha', 'Beta'],
    );
    assert.equal(projects[1].group, 'Frontend');

    await commandHandlers.get('simpleProjectSwitcher.open')(projects[0]);
    assert.deepEqual(openedFolders[0][1], { forceReuseWindow: true });

    await commandHandlers.get('simpleProjectSwitcher.openNewWindow')(projects[0]);
    assert.deepEqual(openedFolders[1][1], { forceNewWindow: true });

    inputResponses.push('Alpha Renamed');
    quickPickResponses.push((items) =>
      items.find((item) => item.group === ''),
    );
    await commandHandlers.get('simpleProjectSwitcher.edit')(projects[0]);

    roots = provider.getChildren();
    const frontend = roots.find(
      (root) => provider.getTreeItem(root).label === 'Frontend',
    );
    const edited = roots.find((root) => root.name === 'Alpha Renamed');
    assert.equal(provider.getChildren(frontend)[0].name, 'Beta');
    assert.equal(edited.path, 'C:\\work\\alpha');
    assert.equal(edited.group, '');

    warningResponses.push('Delete');
    await commandHandlers.get('simpleProjectSwitcher.delete')(edited);

    projects = provider.getChildren(provider.getChildren()[0]);
    warningResponses.push('Delete');
    await commandHandlers.get('simpleProjectSwitcher.delete')(projects[0]);
    assert.equal(provider.getChildren().length, 0);

    vscodeMock.workspace.name = undefined;
    vscodeMock.workspace.workspaceFolders = [];
    dialogResponses.push([Uri.file('C:\\work\\gamma')]);
    inputResponses.push('Gamma', '');
    await commandHandlers.get('simpleProjectSwitcher.addFromDisk')();

    roots = provider.getChildren();
    assert.equal(roots[0].name, 'Gamma');
    assert.equal(provider.getTreeItem(roots[0]).contextValue, 'project');

    await commandHandlers.get('simpleProjectSwitcher.openSettingsJson')();
    assert.equal(settingsOpened, true);
    assert.deepEqual(errors, []);
    assert.equal(context.subscriptions.length, 11);
  } finally {
    Module._load = originalLoad;
  }
});
