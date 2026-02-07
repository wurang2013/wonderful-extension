import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    console.log('Wonderful Extension 已激活！');

    const treeDataProvider = new TabTreeProvider(context);
    
    // 1. 注册树视图
    vscode.window.registerTreeDataProvider('edge-tabs-view', treeDataProvider);

    // 2. 监听标签页变化
    vscode.window.tabGroups.onDidChangeTabs(() => {
        treeDataProvider.refresh();
    });

    // 监听激活的编辑器变化（实现点击右侧，左侧图标实时同步更新）
    vscode.window.onDidChangeActiveTextEditor(() => {
        treeDataProvider.refresh();
    });

    // 3. 注册命令：点击文件跳转
    vscode.commands.registerCommand('edge-tabs-view.openTab', (tab: vscode.Tab) => {
        if (tab.input instanceof vscode.TabInputText) {
            vscode.window.showTextDocument(tab.input.uri);
        }
    });

    // 4. 注册命令：加入分组
    vscode.commands.registerCommand('edge-tabs-view.addToGroup', async (item: vscode.Tab) => {
        const groupName = await vscode.window.showInputBox({ 
            prompt: '输入分组名称（例如：后端、前端、待办）',
            placeHolder: '新建或选择已有分组'
        });
        if (groupName) {
            await treeDataProvider.addToGroup(groupName, item);
        }
    });

    // 5. 注册命令：从分组中移除
    vscode.commands.registerCommand('edge-tabs-view.removeFromGroup', async (item: vscode.Tab) => {
        await treeDataProvider.removeFromGroup(item);
    });
}

class TabTreeProvider implements vscode.TreeDataProvider<string | vscode.Tab> {
    private _onDidChangeTreeData = new vscode.EventEmitter<string | vscode.Tab | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private context: vscode.ExtensionContext) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    private getSavedGroups(): Record<string, string[]> {
        return this.context.globalState.get('tabGroups') || {};
    }

    async addToGroup(groupName: string, tab: vscode.Tab) {
        const groups = this.getSavedGroups();
        if (tab.input instanceof vscode.TabInputText) {
            const uri = tab.input.uri.toString();
            if (!groups[groupName]) groups[groupName] = [];
            if (!groups[groupName].includes(uri)) {
                // 确保一个文件只在一个自定义组里
                for (const key in groups) {
                    groups[key] = groups[key].filter(u => u !== uri);
                }
                groups[groupName].push(uri);
                await this.context.globalState.update('tabGroups', groups);
                this.refresh();
            }
        }
    }

    async removeFromGroup(tab: vscode.Tab) {
        const groups = this.getSavedGroups();
        if (tab.input instanceof vscode.TabInputText) {
            const uri = tab.input.uri.toString();
            let changed = false;
            for (const key in groups) {
                const index = groups[key].indexOf(uri);
                if (index > -1) {
                    groups[key].splice(index, 1);
                    if (groups[key].length === 0) delete groups[key];
                    changed = true;
                }
            }
            if (changed) {
                await this.context.globalState.update('tabGroups', groups);
                this.refresh();
            }
        }
    }

    getTreeItem(element: string | vscode.Tab): vscode.TreeItem {
        if (typeof element === 'string') {
            // --- 分组样式 ---
            const item = new vscode.TreeItem(element, vscode.TreeItemCollapsibleState.Expanded);
            item.contextValue = 'folder';
            
            if (element === '未分类') {
                item.iconPath = new vscode.ThemeIcon('library');
            } else {
                // 自定义分组使用带颜色的文件夹图标
                item.iconPath = new vscode.ThemeIcon('symbol-folder', new vscode.ThemeColor('charts.blue'));
            }
            return item;
        } else {
            // --- 文件样式 ---
            const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
            
            if (element.isActive) {
                // 激活状态：使用目标瞄准图标，并设为绿色/主题色
                item.iconPath = new vscode.ThemeIcon('target', new vscode.ThemeColor('charts.green'));
                item.description = '(正在编辑)';
            } else {
                item.iconPath = new vscode.ThemeIcon('file');
            }

            item.command = {
                command: 'edge-tabs-view.openTab',
                arguments: [element],
                title: 'Open Tab'
            };
            return item;
        }
    }

    getChildren(element?: string | vscode.Tab): (string | vscode.Tab)[] {
        const groups = this.getSavedGroups();
        const allTabs = vscode.window.tabGroups.all.flatMap(g => g.tabs);
        const assignedUris = new Set(Object.values(groups).flat());

        if (!element) {
            const groupNames = Object.keys(groups);
            const hasUnassigned = allTabs.some(t => 
                t.input instanceof vscode.TabInputText && !assignedUris.has(t.input.uri.toString())
            );
            return hasUnassigned ? ['未分类', ...groupNames] : groupNames;
        } else if (typeof element === 'string') {
            if (element === '未分类') {
                return allTabs.filter(t => 
                    t.input instanceof vscode.TabInputText && !assignedUris.has(t.input.uri.toString())
                );
            } else {
                const uris = groups[element] || [];
                return allTabs.filter(t => 
                    t.input instanceof vscode.TabInputText && uris.includes(t.input.uri.toString())
                );
            }
        }
        return [];
    }
}

export function deactivate() {}