import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import actions from './actions';

interface iconConfigList extends iconConfigProps {
  rootPath: string;
  icons: IconProps[];
}

class IconViewProvider implements vscode.WebviewViewProvider {
  public iconConfigList: iconConfigList[] = [];
  private rootPath: string = '';
  private iconConfig: iconConfigProps[] = [];
  private view?: vscode.WebviewView;
  private currentIconConfig?: iconConfigList;
  private search: string = '';

  constructor(private readonly _extensionUri: vscode.Uri) {
    this.getIconConfig();
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    webviewView.webview.options = {
      enableScripts: true
    };
    this.view = webviewView;

    this.render();
    this.receiveMessage();
  }

  public render() {
    const iconConfig = this.getIconInfo();
    const html = this.getWebviewContent(iconConfig);
    this.view!.webview.html = html;
  }

  /**
   * 刷新视图
   */
  public reload(reset: boolean = true) {
    if (reset) {
      this.search = '';
    }
    this.iconConfigList = [];
    this.getIconConfig();
    this.render();
  }

  /**
   * 打开图标注册文件
   */
  public openRegisterFile() {
    if (this.currentIconConfig) {
      const iconPath = this.currentIconConfig.iconPath;
      const rootPath = this.currentIconConfig.rootPath;
      const iconAPath = path.join(rootPath, iconPath);
      // 打开svg文件
      vscode.workspace.openTextDocument(iconAPath).then(doc => {
        // 在VSCode编辑窗口展示读取到的文本
        vscode.window.showTextDocument(doc);
      });
    }
  }

  /**
   * 监听 webview 的消息
   */
  private receiveMessage() {
    this.view!.webview.onDidReceiveMessage(message => {
      const data = message.data;
      switch (message.type as messageType) {
        case 'view': {
          const p = data.rootPath
            ? path.join(data.rootPath, data.path)
            : data.path;
          // 打开文件
          vscode.workspace.openTextDocument(p).then(doc => {
            // 在VSCode编辑窗口展示读取到的文本
            vscode.window.showTextDocument(doc);
          });
          break;
        }
        case 'delete': {
          try {
            actions.deleteIcon(data);
            this.messageSuccess('删除成功');
          } catch (error) {
            this.messageError('删除失败');
          }
          break;
        }
        case 'importIcon': {
          try {
            actions.importIcon(data);
            this.search = data.map((item: any) => item.name).join(',');
            this.messageSuccess('导入成功');
          } catch (error) {
            this.messageError('导入失败');
          }
          break;
        }
        case 'search': {
          this.search = data;
          break;
        }
        case 'optimization': {
          try {
            const res = actions.optimization(data);
            this.reload(false);
            vscode.workspace.openTextDocument(data.iconAPath).then(doc => {
              // 在VSCode编辑窗口展示读取到的文本
              vscode.window.showTextDocument(doc);

              setTimeout(() => {
                this.messageSuccess(
                  `优化成功，体积从 ${res.beforeSize}KB 减少到 ${res.afterSize}KB，优化率 ${res.optimizationRate}% `
                );
              }, 1000);
            });
          } catch (error) {
            this.messageError('优化失败');
          }
          break;
        }
      }
    });
  }

  /**
   * 获取当前文件的可使用的图标
   */
  public getIconInfo() {
    const editor = vscode.window.activeTextEditor; // 获取当前文档实例
    if (editor) {
      const currentUri = editor.document.uri.path; // 获取当前文档地址
      const currentIconConfig = this.iconConfigList.find(item => {
        if (currentUri.includes(path.join(item.rootPath, item.name) + '/')) {
          return item;
        }
      });
      if (currentIconConfig) {
        this.currentIconConfig = currentIconConfig;
        return currentIconConfig;
      }
    }
  }

  /**
   * 获取项目中的全部图标信息
   */
  private getAllSvgIcon(uri: string) {
    const files = fs.readdirSync(uri);
    const svgList: {aPath: string; name: string; svg: string}[] = [];
    files.forEach(fileName => {
      const filePath = path.join(uri, fileName);
      const stat = fs.lstatSync(filePath);
      if (stat.isFile()) {
        if (fileName.endsWith('.svg')) {
          svgList.push({
            aPath: filePath,
            name: fileName,
            svg: fs.readFileSync(filePath, 'utf8')
          });
        }
      } else {
        svgList.push(...this.getAllSvgIcon(filePath));
      }
    });
    return svgList;
  }

  /**
   * 获取项目图标配置
   */
  private getIconConfig() {
    const rootWorkspace = vscode.workspace.workspaceFolders;
    try {
      rootWorkspace?.forEach(workspaceFolder => {
        const uri = workspaceFolder.uri.path;
        this.rootPath = uri;
        const iconConfigFile = fs.readFileSync(
          path.join(uri, '.vscode/iconConfig.json'),
          'utf-8'
        );
        if (iconConfigFile) {
          const iconConfig = JSON.parse(iconConfigFile);
          this.iconConfig = iconConfig;
          iconConfig.forEach((info: iconConfigProps) => {
            // 获取已经注册的图标信息
            const iconPath = path.join(uri, info.iconPath);
            const code = fs.readFileSync(path.join(iconPath), 'utf8');
            const codeIconList = code.match(/import .* from '.*\.svg'/g);
            const codeRegisterIconList = code.match(
              /registerIcon\('(.*)', (.*)\)/g
            );
            const iconList: IconProps[] = [];
            if (
              codeIconList &&
              codeIconList.length > 0 &&
              codeRegisterIconList &&
              codeRegisterIconList.length > 0
            ) {
              const registerIconInfo: any = {};
              codeRegisterIconList.forEach(code => {
                const info = /registerIcon\('(.*)', (.*)\)/.exec(code);
                if (info) {
                  registerIconInfo[info[2]] = info[1];
                }
              });
              codeIconList.forEach(code => {
                const info = /import (.*) from '(.*\.svg)'/.exec(code);
                if (info) {
                  const aPath = path.resolve(iconPath, '../' + info[2]);
                  iconList.push({
                    class: info[1],
                    name: registerIconInfo[info[1]],
                    path: info[2],
                    aPath: aPath
                  });
                }
              });
            }
            // 获取全部图标信息
            const allIcon = this.getAllSvgIcon(path.join(uri, info.iconDir));

            this.iconConfigList.push({
              rootPath: uri,
              icons: allIcon.map(svg => {
                const icon = iconList.find(
                  item => item.aPath === svg.aPath
                ) || {unRegister: true, name: svg.name};
                return {
                  aPath: svg.aPath,
                  svg: svg.svg,
                  ...icon
                };
              }),
              ...info
            });
          });
        }
      });
    } catch (error: any) {
      console.error(error);
    }
  }
  /**
   * 绘制html
   */
  private getWebviewContent(config?: iconConfigList) {
    const {
      icons,
      name: projectName,
      iconPath: configPath,
      rootPath,
      iconDir
    } = config || {};
    const iconList = icons?.map(icon => {
      return {
        ...icon
      };
    });

    return this.html(iconList, {
      projectName,
      configPath,
      rootPath: rootPath || this.rootPath,
      iconDir,
      iconConfig: this.iconConfig
    });
  }

  private html(icons: IconProps[] = [], projectConfig: ProjectConfig) {
    const scriptUri = this.view!.webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist/webview', 'main.js')
    );
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>图标列表</title>
        </head>
        <body>
          <div id="root"></div>
          <script>
            var icons = ${JSON.stringify(icons)};
            var projectConfig = ${JSON.stringify(projectConfig)};
            var search = '${this.search}';
            window.vscode = acquireVsCodeApi();
          </script>
          <script src="${scriptUri}">
        </body>
      </html>
    `;
  }

  public postMessage(message: any) {
    this.view!.webview.postMessage(message);
    if (message.type === 'toast' && message.data.status === 'success') {
      setTimeout(() => {
        this.reload(false);
      }, 1000);
    }
  }

  public messageSuccess(message: string) {
    this.postMessage({
      type: 'toast',
      data: {
        status: 'success',
        message
      }
    });
  }

  public messageError(message: string) {
    this.postMessage({
      type: 'toast',
      data: {
        status: 'error',
        message
      }
    });
  }
}

export default IconViewProvider;
