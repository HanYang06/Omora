"use strict";

/** VS Code 接线层：只把光标位置交给 lib/keys.js，再把结果包成编辑器对象。 */

const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");
const lib = require("./lib/keys");

const INDEX_FILE = "keys.json";
const PYTHON = { language: "python" };

let cache = null;

function workspaceRoot() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return null;
  }
  return folders[0].uri.fsPath;
}

function reload() {
  cache = null;
}

function keysOf(root) {
  if (cache !== null && cache.root === root) {
    return cache.keys;
  }
  const file = path.join(root, INDEX_FILE);
  try {
    const keys = lib.parseIndex(fs.readFileSync(file, "utf8"));
    cache = { root, keys };
    return keys;
  } catch (error) {
    void vscode.window.showWarningMessage(
      "Omora: 读不到 " + INDEX_FILE + "（先跑 scripts/keys.py）",
    );
    return [];
  }
}

function entryAt(document, position) {
  const root = workspaceRoot();
  if (root === null) {
    return undefined;
  }
  const key = lib.keyAt(document.getText(), document.offsetAt(position));
  if (key === null) {
    return undefined;
  }
  return lib.findKey(keysOf(root), key);
}

const hoverProvider = {
  provideHover(document, position) {
    const entry = entryAt(document, position);
    if (entry === undefined) {
      return undefined;
    }
    return new vscode.Hover(new vscode.MarkdownString(lib.hoverFor(entry)));
  },
};

const definitionProvider = {
  provideDefinition(document, position) {
    const entry = entryAt(document, position);
    if (entry === undefined) {
      return undefined;
    }
    const target = lib.definitionOf(entry);
    if (target === null) {
      return undefined;
    }
    const root = workspaceRoot();
    if (root === null) {
      return undefined;
    }
    const uri = vscode.Uri.file(path.join(root, target.path));
    return new vscode.Location(uri, new vscode.Position(target.line - 1, 0));
  },
};

async function listKeys() {
  const root = workspaceRoot();
  if (root === null) {
    return;
  }
  const keys = keysOf(root);
  const picked = await vscode.window.showQuickPick(
    keys.map((entry) => ({ label: entry.key, description: lib.listLine(entry), entry })),
    { placeHolder: "界面键（选中跳到声明处）" },
  );
  if (picked === undefined) {
    return;
  }
  const target = lib.definitionOf(picked.entry);
  if (target === null) {
    return;
  }
  const uri = vscode.Uri.file(path.join(root, target.path));
  await vscode.window.showTextDocument(uri, {
    selection: new vscode.Range(target.line - 1, 0, target.line - 1, 0),
  });
}

function activate(context) {
  context.subscriptions.push(vscode.languages.registerHoverProvider(PYTHON, hoverProvider));
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(PYTHON, definitionProvider),
  );
  context.subscriptions.push(vscode.commands.registerCommand("omora.listKeys", listKeys));
  context.subscriptions.push(vscode.commands.registerCommand("omora.reloadKeys", reload));
}

function deactivate() {
  reload();
}

module.exports = { activate, deactivate };
