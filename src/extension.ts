/*
MIT License

Copyright (c) 2021
Miguel Perales - miguelperalesbermejo@gmail.com 

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

import * as vscode from 'vscode';
//import * as path from 'path';
import * as fs from 'fs';
import * as child from 'child_process';
import clipboardy = require('clipboardy');

let metadataTypesList:any;
let metadataTemplatesJson:any;
let apiVersion:any;

const configurationSection = 'sfdxmetahelper';


function getConfiguration() {
    const config = vscode.workspace.getConfiguration(configurationSection);

	apiVersion = config.get('defaultAPI');
	metadataTypesList = config.get('metadataTypes');
	metadataTypesList.sort(function (a:any, b:any) {
		return a.toLowerCase().localeCompare(b.toLowerCase());
	});
	metadataTemplatesJson = config.get('metadataTemplates');
}

export function activate(context: vscode.ExtensionContext) {
	
    vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration(configurationSection)) {
            getConfiguration();
        }
    }, undefined, context.subscriptions);


	context.subscriptions.push(
		vscode.commands.registerCommand('sfdxmetahelper.start', () => {
			sfdxMetahelperPanel.createOrShow(context.extensionUri);
		})
	);
	
	if (vscode.window.registerWebviewPanelSerializer) {
		// Make sure we register a serializer in activation event
		vscode.window.registerWebviewPanelSerializer(sfdxMetahelperPanel.viewType, {
			async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel, state: any) {
				//console.log(`Got state: ${state}`);
				// Reset the webview options so we use latest uri for `localResourceRoots`.
				webviewPanel.webview.options = getWebviewOptions(context.extensionUri);
				sfdxMetahelperPanel.revive(webviewPanel, context.extensionUri);
			}
		});
	}
    
}

function getWebviewOptions(extensionUri: vscode.Uri): vscode.WebviewOptions {
	return {
		// Enable javascript in the webview
		enableScripts: true,

		// And restrict the webview to only loading content from our extension's `media` directory.
		localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
	};
}


/**
 * Manages sfdx metahelper webview panels
 */
class sfdxMetahelperPanel {
	/**
	 * Track the currently panel. Only allow a single panel to exist at a time.
	 */
	public static currentPanel: sfdxMetahelperPanel | undefined;

	public static readonly viewType = 'sfdxmetahelper';

	private readonly _panel: vscode.WebviewPanel;
	private readonly _extensionUri: vscode.Uri;
	private _disposables: vscode.Disposable[] = [];

	public static createOrShow(extensionUri: vscode.Uri) {
		const column = vscode.window.activeTextEditor
			? vscode.window.activeTextEditor.viewColumn
			: undefined;

		// If we already have a panel, show it.
		if (sfdxMetahelperPanel.currentPanel) {
			sfdxMetahelperPanel.currentPanel._panel.reveal(column);
			return;
		}

		// Otherwise, create a new panel.
		const panel = vscode.window.createWebviewPanel(
			sfdxMetahelperPanel.viewType,
			'sfdx metahelper',
			column || vscode.ViewColumn.One,
			{
				// Enable javascript in the webview
				enableScripts: true,
				retainContextWhenHidden: true,
				// And restrict the webview to only loading content from our extension's `media` directory.
				localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
			}
		);

		sfdxMetahelperPanel.currentPanel = new sfdxMetahelperPanel(panel, extensionUri);
	}

	public static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
		sfdxMetahelperPanel.currentPanel = new sfdxMetahelperPanel(panel, extensionUri);
	}

	private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
		this._panel = panel;
		this._extensionUri = extensionUri;

		// Set the webview's initial html content
		this._update();

		// Listen for when the panel is disposed
		// This happens when the user closes the panel or when the panel is closed programatically
		this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

		// Update the content based on view changes
		/*this._panel.onDidChangeViewState(
			e => {
				if (this._panel.visible) {
					this._update();
				}
			},
			null,
			this._disposables
		);
		*/
		
		// Handle messages from the webview
		this._panel.webview.onDidReceiveMessage(
			message => {
				switch (message.command) {
					case 'onGetUsers':
						this.getUsers();
						return;
					case 'addMetadata':
						this.addMetadata();
						return;
					case 'copyToClipboard':
						this.copyToClipboard(message.text);
						return;
					case 'previewMetadata':
						this.previewMetadata(message.user, message.metadataTypes);
						return;
					case 'saveFile':
						this.saveFile(message.text);
						return;
					case 'setFolder':
						this.setFolder();
						return;
					case 'initialize':
						this.init();
						return;
					case 'alert':
						console.log(message.text);
						return;
				}
			},
			null,
			this._disposables
		);
	}

	public dispose() {
		sfdxMetahelperPanel.currentPanel = undefined;

		// Clean up our resources
		this._panel.dispose();

		while (this._disposables.length) {
			const x = this._disposables.pop();
			if (x) {
				x.dispose();
			}
		}
	}

	private init()
	{
		this._panel.webview.postMessage({ command: 'initApiVersion', results : apiVersion});
		this._panel.webview.postMessage({ command: 'initMetadataTypes', results : metadataTypesList});
		this._panel.webview.postMessage({ command: 'initMetadataTemplates', results : metadataTemplatesJson});
	}

	private _update() {
		const webview = this._panel.webview;
		this._panel.title = 'SFDX MetaHelper';
		getConfiguration();
		this._panel.webview.html = this._getHtmlForWebview(webview);
	}

	private getUsers(){
		const cmd ="sfdx alias:list --json ";
		const p = new Promise(resolve => {
			vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: "Getting SFDX list of users",
				cancellable: true
			}, (progress, token) => {
				token.onCancellationRequested(() => {
					console.log("Canceled");
				});
				return this.execCmd(cmd);
			
			}).then((res) => {
				return this._panel.webview.postMessage({ command: "usersRetrieved", results : res});
			});
		});
	}

	public copyToClipboard(value:any) {
		clipboardy.write(value).then((result:any)=>{
			//vscode.window.showInformationMessage("Copied to clipboard");
			vscode.window.setStatusBarMessage("Copied to clipboard", 5000);
		});
	}

	public previewMetadata(user:any, metadataTypes:any) {
		if (metadataTypes !== null && metadataTypes !== undefined) {
			const metadataTypesSplitted = metadataTypes.split(",");
			for (const i in metadataTypesSplitted)		
			{
				let addWildcard = false;
				let charMetaSeparator = "";
				let needPrefixAddition = false;
				let specialReplace = false;
				let folder = "";
				let simpleListMetadata = true;
				if (["CustomMetadata", "QuickAction"].includes(metadataTypesSplitted[i]))
				{
					charMetaSeparator = ".";
					needPrefixAddition = true;
				}
				if (metadataTypesSplitted[i] == "Layout")
				{
					charMetaSeparator = "-";
					needPrefixAddition = true;
					specialReplace = true;
				}
				if (metadataTypesSplitted[i] == "Flow")
				{
					addWildcard = true;
				}
				if (metadataTypesSplitted[i] == "Dashboard")
				{
					simpleListMetadata = false;
					folder = "DashboardFolder";
				}
				if (metadataTypesSplitted[i] == "Document")
				{
					simpleListMetadata = false;
					folder = "DocumentFolder";
				}
				if (metadataTypesSplitted[i] == "EmailTemplate")
				{
					simpleListMetadata = false;
					folder = "EmailFolder";
				}
				if (metadataTypesSplitted[i] == "Report")
				{
					simpleListMetadata = false;
					folder = "ReportFolder";
				}
				if (simpleListMetadata)
				{
					const resultMetadata: { fullName: any; metadataType: any; folderName: string; simpleListMetadata: boolean, addWildcard: boolean, folderMeta: string}[] = [];
					const cmd = "sfdx force:mdapi:listmetadata --apiversion " + apiVersion + " --targetusername " + user + " --metadatatype " + metadataTypesSplitted[i] + " --json";
					const p = new Promise(resolve => {
						vscode.window.withProgress({
							location: vscode.ProgressLocation.Notification,
							title: "List " + metadataTypesSplitted[i],
							cancellable: true
						}, (progress, token) => {
							token.onCancellationRequested(() => {
								console.log("Canceled");
							});
							return this.execCmd(cmd);
						
						}).then((res: any) => {
							const folderName = metadataTypesSplitted[i];
							if (res.result == "undefined" || !res)
							{
								console.log("Metadata Type not supported.");
								return;
							}
							let metadataDict = [];
							if (Array.isArray(res.result))
							{
								metadataDict = res.result;
							}
							else
							{
								metadataDict.push(res.result);
							}
							for(const j in metadataDict)
							{
								if ("fullName" in metadataDict[j])
								{
									let nameToAdd = metadataDict[j].fullName;
									if ("namespacePrefix" in metadataDict[j])
									{
										if (needPrefixAddition)
										{
											if (specialReplace)
											{
												nameToAdd = nameToAdd.replace(charMetaSeparator, charMetaSeparator + metadataDict[j].namespacePrefix + "__", 1);
											}
											else
											{
												nameToAdd = nameToAdd.replace(charMetaSeparator, charMetaSeparator + metadataDict[j].namespacePrefix + "__");
											}
										}
									}
									resultMetadata.push({fullName: nameToAdd, metadataType: metadataTypesSplitted[i], folderName: folderName, simpleListMetadata: simpleListMetadata, addWildcard: addWildcard, folderMeta: ""});
								}
							}
							this._panel.webview.postMessage({ command: 'metadataTypeListed', metadataType: metadataTypesSplitted[i], results : resultMetadata});
						});
					});
				}
				else
				{
					const resultMetadata: { fullName: any; metadataType: any; folderName: string; simpleListMetadata: boolean, addWildcard: boolean, folderMeta: string}[] = [];
					const cmd = "sfdx force:mdapi:listmetadata --apiversion " + apiVersion + " --targetusername " + user + " --metadatatype " + folder + " --json";
					const p = new Promise(resolve => {
						vscode.window.withProgress({
							location: vscode.ProgressLocation.Notification,
							title: "List " + folder,
							cancellable: true
						}, (progress, token) => {
							token.onCancellationRequested(() => {
								console.log("Canceled");
							});
							return this.execCmd(cmd);
						
						}).then((res: any) => {
							if (res.result == "undefined" || !res)
							{
								console.log("Metadata Type not supported.");
								return;
							}
							let metadataFolders = [];
							if (Array.isArray(res.result))
							{
								metadataFolders = res.result;
							}
							else
							{
								metadataFolders.push(res.result);
							}
							for (const j in metadataFolders)
							{
								if ("fullName" in metadataFolders[j])
								{
									const folderName = metadataFolders[j].fullName;
									const cmd = "sfdx force:mdapi:listmetadata --apiversion " + apiVersion + " --targetusername " + user + " --metadatatype " + metadataTypesSplitted[i] + " --folder " + folderName + " --json";
									const p = new Promise(resolve => {
										vscode.window.withProgress({
											location: vscode.ProgressLocation.Notification,
											title: "List " + folderName,
											cancellable: true
										}, (progress, token) => {
											token.onCancellationRequested(() => {
												console.log("Canceled");
											});
											return this.execCmd(cmd);
										
										}).then((res2: any) => {
											
											if (res2.result == "undefined" || !res)
											{
												console.log("Metadata Type not supported.");
												return;
											}
											console.log(res2.result);
											let metadataDict = [];
											if (Array.isArray(res2.result))
											{
												metadataDict = res2.result;
											}
											else
											{
												metadataDict.push(res2.result);
											}
											for(const h in metadataDict)
											{
												if ("fullName" in metadataDict[h])
												{
													const nameToAdd = metadataDict[h].fullName;
													resultMetadata.push({fullName: nameToAdd, metadataType: metadataTypesSplitted[i], folderName: folderName, simpleListMetadata: simpleListMetadata, addWildcard: addWildcard, folderMeta: folder});
												}
											}
											console.log(resultMetadata);
											this._panel.webview.postMessage({ command: 'metadataTypeListed', metadataType: metadataTypesSplitted[i], results : resultMetadata});
										});
									});
								}
							}
						});
					});
				}
			}
		}
	}

	public addMetadata() {
		vscode.window.showInputBox({prompt: 'Add new Metadata Types.', placeHolder: 'Introduce values separated by commas, Ex: CustomObject,Flow...' })
		.then(value => {
			if (value !== null && value !== undefined) {
				const valueSplitted = value.split(",");
				for(const i in valueSplitted)
				{
					metadataTypesList.push(valueSplitted[i].trim());
				}
				metadataTypesList.sort(function (a:any, b:any) {
					return a.toLowerCase().localeCompare(b.toLowerCase());
				});
				this._panel.webview.postMessage({ command: 'initMetadataTypes', results : metadataTypesList});
			}
		});
	}
	

	// Code based on vignaesh01 code from https://github.com/vignaesh01/sfdx-command-builder. More specifically from https://github.com/vignaesh01/sfdx-command-builder/blob/master/src/extension.ts fetchAllCommands method.
	private execCmd(cmd: any) : Promise<any> {
			return new Promise(resolve => {
				
				const workspacePath = vscode.workspace.workspaceFolders;
				const foo: child.ChildProcess = child.exec(cmd,{
					maxBuffer: 1024 * 1024 * 6,
					cwd: workspacePath?workspacePath[0].uri.fsPath:""
				});
			let bufferOutData='';

			if (foo.stdout != null)
			{
				foo.stdout.on("data",(dataArg : any)=> {
					//console.log('stdout: ' + dataArg);
					bufferOutData+=dataArg;
				});
			}
			
			if (foo.stderr != null)
			{
				foo.stderr.on("data",(data : any)=> {
					console.log('stderr: ' + data);
					vscode.window.showErrorMessage(data);
					resolve(true);
				});
			}
	
			if (foo.stdin != null)
			{
				foo.stdin.on("data",(data : any)=> {
					//console.log('stdin: ' + data);
					//vscode.window.showErrorMessage(data);
					resolve(true);
				});
			}
			
			foo.on('exit',(code,signal)=>{
				console.log('exit code '+code);
				//console.log('bufferOutData '+bufferOutData);
				
				const data = JSON.parse(bufferOutData);
				if (code == 1)
				{
					vscode.window.showErrorMessage(data.message);
					resolve(false);
					return;
				}
				//let results = data.result;
				resolve(data);
				return data;
			});
				
			}).then((res) => {
				return res;
			});
	}

	private saveFile(data:any)
	{
		vscode.window.showSaveDialog({ filters: { '*': ['xml'] } }).then(uri => {
			if (!uri) {
				vscode.window.showErrorMessage('You must select a file');
				return; // Don't proceed if we don't have a file URI to write to
			}
			fs.writeFileSync(uri.fsPath, data, {encoding: "utf8"});
			this._panel.webview.postMessage({ command: 'fileSaved', results : uri.fsPath});
			});
	}

	private setFolder()
	{
		const options: vscode.OpenDialogOptions = {
			canSelectMany: false,
			openLabel: 'Select Folder',
			canSelectFiles: false,
			canSelectFolders: true
		}; 
		vscode.window.showOpenDialog(options).then(fileUri => {
			if (fileUri && fileUri[0]) {
				//console.log('Selected folder: ' + fileUri[0].fsPath);
				this._panel.webview.postMessage({ command: 'folderSet', results : fileUri[0].fsPath});
			}
		});
	}

	private _getHtmlForWebview(webview: vscode.Webview) {
		// Local path to main script run in the webview
		const scriptPathOnDisk = vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js');

		// And the uri we use to load this script in the webview
		const scriptUri = webview.asWebviewUri(scriptPathOnDisk);

		// Local path to css styles
		const styleResetPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'reset.css');
		const stylesPathMainPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'vscode.css');

		// Uri to load styles into webview
		const stylesResetUri = webview.asWebviewUri(styleResetPath);
		const stylesMainUri = webview.asWebviewUri(stylesPathMainPath);

		// Use a nonce to only allow specific scripts to be run
		const nonce = getNonce();

		return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">

				<!--
					Use a content security policy to only allow loading images from https or from our extension directory,
					and only allow scripts that have a specific nonce.
				-->
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}';">

				<meta name="viewport" content="width=device-width, initial-scale=1.0">

				<link href="${stylesResetUri}" rel="stylesheet">
				<link href="${stylesMainUri}" rel="stylesheet">
				<script nonce="${nonce}" src="https://ajax.googleapis.com/ajax/libs/angularjs/1.8.2/angular.min.js"></script>

				<title>SFDX MetaHelper</title>
			</head>
			<body>
				<div ng-app="myApp" ng-controller="MyController">	
					<form>
						<h1>SFDX MetaHelper</h1>
						<table>
							<tr>
								<td>
									<h3>Select a user:</h3>
								</td>
								<td>
									<select ng-model="userList" ng-options="o.label for o in usersOptions | orderBy:'value'" ng-change="userSelected(userList)" ng-selected="selected">
										<option value="">--None--</option>
									</select>
								</td>
								<td>
								<button ng-click="refreshUsers()">Refresh</button>
								</td>
							</tr>
						</table>				
						<br/>
						<table>
							<tr>
								<td>								
									<h3>Metadata Templates: </h3>
								</td>
								<td>
									<select ng-model="selectedMetadataTemplates" ng-change="selectMetadataTypesFromTemplate(selectedMetadataTemplates)" ng-options="u.metadataTemplate for u in metadataTemplates" ng-selected="selected">
										<option value="">---Please select---</option>
									</select>
								</td>
							</tr>
						</table>
						<table>
							<tr>
								<td>
									<table>
										<tr>
											<td>
												<h3>Metadata Types | Select: </h3>
											</td>
											<td>
												<button ng-click="selectMetadata('All')">All</button>
											</td>
											<td>
												<button ng-click="selectMetadata('None')">None</button>
											</td>
											<!--
											<td>
												<button ng-click="addMetadata()">Add</button>
											</td>
											<td>	
												<button ng-click="delMetadata()">Del</button>
											</td>
											-->
										</tr>
									</table>
								</td>
							</tr>
							<tr>
								<td>
									<select multiple ng-model="selectedMetadataTypes" ng-change="showMetadataTypesSelected()" ng-options="u.metadataTypeName for u in metadataTypes track by u.metadataTypeName" id="selectedMetadataTypesId" ng-selected="selected" class="metadataTypes">
									</select>
								</td>
							</tr>
						</table>
						<table>
							<tr>
								<td>
									<h3>Metadata Types Selected</h3>
								</td>
								<td>
									<button ng-click="copyToClipboard(displayMetadataTypesSelected)">Copy to clipboard</button>
								</td>
							</tr>
						</table>
						<textarea readonly>{{displayMetadataTypesSelected}}</textarea>
						<table>
							<tr>
								<td>
									<h3>----------------------------------------------------</h3>
								</td>
							</tr>
							<tr>
								<td>
									<button ng-click="previewMetadata()">List Metadata</button>
								</td>
							</tr>
						</table>
						<table ng-if="metadataTypesListed.length > 0">
							<tr>
								<td>
									<button ng-click="expandAll()">Expand All</button>
								</td>
								<td>
									<button ng-click="collapseAll()">Collapse All</button>
								</td>
							</tr>
							<tr>
								<td>
									<button ng-click="selectListed('All','global')">Select All</button>
								</td>
								<td>
									<button ng-click="selectListed('None','global')">Select None</button>
								</td>
							</tr>
						</table>
						<table>
							<tr>
								<td>
									<div ng-repeat="metaElem in metadataTypesListed | orderBy: 'name'">
										<h3 class="item" ng-click="expandSection(metaElem)" >{{metaElem.icon}} {{metaElem.name}}</h3>
										<div ng-if="metaElem.expanded">
											<table>
												<tr>
													<td>
														<h4>Select: </h4>
													</td>
													<td>
														<button ng-click="selectListed('All',metaElem.name)">All</button>
													</td>
													<td>
														<button ng-click="selectListed('None',metaElem.name)">None</button></div>
													</td>
													<td>
														<h4> | Filter: </h4>
													</td>
													<td>
														<p><input type="text" ng-model="filterMetadata[metaElem.name]"></p>
													</td>
												</tr>
											</table>
											<select multiple ng-model="selectedMetadataElems[metaElem.name]" ng-change="finalMetadataSelected()" ng-options="u.fullName group by u.folderName for u in metaElem.metadataRecords | orderBy:'fullName' | filter:filterMetadata[metaElem.name]" ng-selected="selected" class="metadataListed">
											</select>
										</div>
										<br/>
									</div>
								</td>
							</tr>
						</table>
						<table ng-if="metadataTypesListed.length > 0">
							<tr>
								<td>
									<table>
										<tr>
											<td>
												<h3>Metadata Selected:</h3>
											</td>
											<td>
												<button ng-click="copyToClipboard(finalMetadataSelectedByType)">Copy to clipboard</button>
											</td>
											<td>
												<h3>Metadata Selected:</h3>
											</td>
										</tr>
									</table>
									<textarea readonly class="outputTextareas">{{finalMetadataSelectedByType}}</textarea>
								</td>
								<td>
									<table>
										<tr>
											<td>
											<h3>Manifest package.xml:</h3>
											</td>
											<td>
												<button ng-click="copyToClipboard(manifestPackageXml)">Copy to clipboard</button>
											</td>
											<td>
											<button ng-click="saveFile(manifestPackageXml)">Save To File</button>
											</td>
										</tr>
									</table>
									<textarea readonly class="outputTextareas">{{manifestPackageXml}}</textarea>
								</td>
							</tr>
						</table>
						<table ng-if="metadataTypesListed.length > 0">
							<tr>
								<td>
									<h3>SFDX Source Metadata Command Suggested:</h3>
								</td>
								<td>
									<button ng-click="copyToClipboard(sfdxSourceMetaCommandSuggestedText)">Copy to clipboard</button>
								</td>
							</tr>
						</table>
						<textarea readonly ng-if="metadataTypesListed.length > 0">{{sfdxSourceMetaCommandSuggestedText}}</textarea>
						<table ng-if="metadataTypesListed.length > 0">
							<tr>
								<td>
								<h3>SFDX Source Retrieve Package Command Suggested:</h3>
								</td>
								<td>
									<button ng-click="copyToClipboard(sfdxSourcePkgCommandSuggestedText)">Copy to clipboard</button>
								</td>
							</tr>
						</table>
						<textarea readonly ng-if="metadataTypesListed.length > 0">{{sfdxSourcePkgCommandSuggestedText}}</textarea>
						<table ng-if="metadataTypesListed.length > 0">
							<tr>
								<td>
									<h3>SFDX MDAPI Retrieve Package Command Suggested:</h3>
								</td>
								<td>
									<button ng-click="setFolder()">Set Folder</button>
								</td>
								<td>
									<button ng-click="copyToClipboard(sfdxMdapiPkgCommandSuggestedText)">Copy to clipboard</button>
								</td>
							</tr>
						</table>
						<textarea readonly ng-if="metadataTypesListed.length > 0">{{sfdxMdapiPkgCommandSuggestedText}}</textarea>
					</form>
				</div>
			<script nonce="${nonce}" src="${scriptUri}"></script>
			</body>
			</html>`;
	}
}

function getNonce() {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
