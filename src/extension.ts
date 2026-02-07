import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    console.log('Wonderful Extension 已激活！');

    const treeDataProvider = new TabTreeProvider(context);
    
    // 1. 注册树视图
    vscode.window.registerTreeDataProvider('edge-tabs-view', treeDataProvider);

    // 2. 监听事件以刷新视图
    vscode.window.tabGroups.onDidChangeTabs(() => treeDataProvider.refresh());
    vscode.window.onDidChangeActiveTextEditor(() => treeDataProvider.refresh());

    // 3. 注册命令：点击文件跳转
    vscode.commands.registerCommand('edge-tabs-view.openTab', (tab: vscode.Tab) => {
        if (tab.input instanceof vscode.TabInputText) {
            vscode.window.showTextDocument(tab.input.uri);
        }
    });

    // 4. 注册命令：加入分组
    vscode.commands.registerCommand('edge-tabs-view.addToGroup', async (item: vscode.Tab) => {
    // 1. 获取现有分组
    const savedGroups = context.globalState.get<Record<string, string[]>>('tabGroups') || {};
    const groupNames = Object.keys(savedGroups);

    // 2. 构造下拉列表选项
    // 我们手动在最前面加一个“+ 新建分组...”的特殊选项
    const items: vscode.QuickPickItem[] = [
        { label: '$(plus) 新建分组...', alwaysShow: true },
        ...groupNames.map(name => ({ label: `$(folder) ${name}`, description: '移动到此分组' }))
    ];

    // 3. 弹出下拉选择框
    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: '选择一个分组或新建分组',
        title: '移动标签页到分组'
    });

    if (!selected) return; // 用户按了 Esc 取消

    let targetGroupName: string | undefined;

    if (selected.label === '$(plus) 新建分组...') {
        // 4. 如果选了新建，再弹出输入框
        targetGroupName = await vscode.window.showInputBox({
            prompt: '请输入新分组的名称',
            validateInput: (value) => value.trim() === '' ? '名称不能为空' : null
        });
    } else {
        // 5. 如果选了已有分组，去掉图标前缀拿到纯名字
        targetGroupName = selected.label.replace('$(folder) ', '');
    }

    // 6. 执行移动逻辑
    if (targetGroupName) {
        await treeDataProvider.addToGroup(targetGroupName.trim(), item);
    }
});

    // 5. 注册命令：从分组中移除单个文件
    vscode.commands.registerCommand('edge-tabs-view.removeFromGroup', async (item: vscode.Tab) => {
        await treeDataProvider.removeFromGroup(item);
    });

    // 6. 注册命令：删除整个分组 (保留文件)
    vscode.commands.registerCommand('edge-tabs-view.deleteGroup', async (groupName: string) => {
        await treeDataProvider.deleteGroup(groupName);
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

    // 添加到分组
    async addToGroup(groupName: string, tab: vscode.Tab) {
        const groups = this.getSavedGroups();
        if (tab.input instanceof vscode.TabInputText) {
            const uri = tab.input.uri.toString();
            // 先从所有现有组中移除该 URI
            for (const key in groups) {
                groups[key] = groups[key].filter(u => u !== uri);
            }
            // 加入新组
            if (!groups[groupName]) groups[groupName] = [];
            groups[groupName].push(uri);
            
            await this.context.globalState.update('tabGroups', groups);
            this.refresh();
        }
    }

    // 移除单个文件
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

    // 删除整个分组
    async deleteGroup(groupName: string) {
        const groups = this.getSavedGroups();
        if (groups[groupName]) {
            delete groups[groupName];
            await this.context.globalState.update('tabGroups', groups);
            this.refresh();
            vscode.window.showInformationMessage(`分组 "${groupName}" 已移除，文件已回退。`);
        }
    }

    getTreeItem(element: string | vscode.Tab): vscode.TreeItem {
        if (typeof element === 'string') {
            const item = new vscode.TreeItem(element, vscode.TreeItemCollapsibleState.Expanded);
            
            // 关键：通过 contextValue 控制右键菜单显示什么
            if (element === '未分类') {
                item.contextValue = 'unassignedGroup';
                item.iconPath = new vscode.ThemeIcon('library');
            } else {
                item.contextValue = 'customGroup';
                item.iconPath = new vscode.ThemeIcon('symbol-folder', new vscode.ThemeColor('charts.blue'));
            }
            return item;
        } else {
            const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
            item.contextValue = 'tabItem';
            
            if (element.isActive) {
                item.iconPath = new vscode.ThemeIcon('target', new vscode.ThemeColor('charts.green'));
                item.description = '(活动)';
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