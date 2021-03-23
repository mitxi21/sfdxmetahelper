
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

/* eslint-disable no-undef */

// This script will be run within the webview itself
// It cannot access the main VS Code APIs directly.
  
const vscode = acquireVsCodeApi();

const oldState = vscode.getState();
var app = angular.module('myApp', []);
app.controller('MyController', function($scope, $window) {
    $scope.usersOptions = [];
    $scope.displayMetadataTypesSelected = "None";
    $scope.userSelected = "--None--";
    $scope.metadataTypes = [];
    $scope.metadataTemplates = [];
    $scope.metadataTemplatesJson = {};
    $scope.metadataTypesListed = [];
    $scope.selectedMetadataElems = {};
    $scope.apiVersion = "48.0";
    $scope.sfdxSourceMetaCommandSuggestedText = "";
    $scope.sfdxMdapiPkgCommandSuggestedText = "";
    $scope.sfdxSourcePkgCommandSuggestedText = "";
    $scope.filePath = "";

    $scope.init = function() {
        vscode.postMessage({
            command: 'initialize',
            text: 'initialize'
        });
    };

    $scope.refreshUsers = function(text) {
        vscode.postMessage({
            command: 'onGetUsers',
            text: 'Retrieving users'
        });
    };

    $scope.userSelected = function(userList) {
        $scope.userSelected = userList.value;
    };

    $scope.showMetadataTypesSelected = function() {
        
        var valuesSelected = "";
        var first = true;

        for (i in $scope.selectedMetadataTypes)
        {
            if (first)
            {
                valuesSelected += $scope.selectedMetadataTypes[i].metadataTypeName;
                first = false;
            }
            else
            {
                valuesSelected += "," + $scope.selectedMetadataTypes[i].metadataTypeName;
            }
        }
        $scope.displayMetadataTypesSelected = valuesSelected;
    };

    $scope.selectMetadataTypesFromTemplate = function(value) {
        var found = false;
        var i = 0;
        $scope.selectedMetadataTypes = [];
        while (i < $scope.metadataTemplatesJson.templates.length && !found)
        {
            if ($scope.metadataTemplatesJson.templates[i].name == value.metadataTemplate)
            {
                for (j in $scope.metadataTypes)
                {
                    if ($scope.metadataTemplatesJson.templates[i].values.includes($scope.metadataTypes[j].metadataTypeName))
                    {
                        $scope.metadataTypes[j].selected = true;
                        $scope.selectedMetadataTypes.push($scope.metadataTypes[j]);
                    }
                    else
                    {
                        $scope.metadataTypes[j].selected = false;
                    }
                }
                found = true;
            }
            i++;
        }
        $scope.showMetadataTypesSelected();
        var element = $window.document.getElementById("selectedMetadataTypesId");
        element.focus();
    };

    $scope.finalMetadataSelected = function() {
        $scope.finalMetadataSelectedByType = "";
        $scope.manifestPackageXml = "";
        var firstMeta = true;
        var first = true;
        var metaItems = "";
        var wildcardToAdd = false;
        var typesAdded = false;
        var foldersNameAdded = [];
        if ($scope.selectedMetadataElems.length == 0)
        {
            return;
        }
        $scope.finalMetadataSelectedByType = "\"";
        $scope.manifestPackageXml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        $scope.manifestPackageXml += '<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n';
        for (metaName in $scope.selectedMetadataElems)
        {
            metaItems = "";
            first = true;
            wildcardToAdd = false;
            typesAdded = false;
            foldersAdded = [];
            for (j in $scope.selectedMetadataElems[metaName])
            {
                if (first)
                {
                    metaItems += $scope.selectedMetadataElems[metaName][j].fullName;
                    first = false;
                }
                else
                {
                    metaItems += "," + $scope.selectedMetadataElems[metaName][j].fullName;
                }
                if (!typesAdded)
                {
                    $scope.manifestPackageXml += '\t<types>\n';
                    typesAdded = true;
                }
                if (!wildcardToAdd && $scope.selectedMetadataElems[metaName][j].addWildcard)
                {
                    wildcardToAdd = true;
                }
                if (!$scope.selectedMetadataElems[metaName][j].simpleListMetadata)
                {
                    if (!foldersNameAdded.includes($scope.selectedMetadataElems[metaName][j].folderName))
                    {
                        foldersNameAdded.push($scope.selectedMetadataElems[metaName][j].folderName);
                        $scope.manifestPackageXml += '\t\t<members>' + $scope.selectedMetadataElems[metaName][j].folderName + '</members>\n';
                        metaItems += "," + $scope.selectedMetadataElems[metaName][j].folderMeta + ":" + $scope.selectedMetadataElems[metaName][j].folderName;
                    }
                }
                $scope.manifestPackageXml += '\t\t<members>' + $scope.selectedMetadataElems[metaName][j].fullName + '</members>\n';
            }
            if (typesAdded)
            {
                if (wildcardToAdd)
                {
                    $scope.manifestPackageXml += '\t\t<members>*</members>\n';
                }
                $scope.manifestPackageXml += '\t\t<name>' + metaName + '</name>\n';
                $scope.manifestPackageXml += '\t</types>\n';
            }
            if (firstMeta)
            {
                $scope.finalMetadataSelectedByType += metaName + ":" + metaItems;
                firstMeta = false;
            }
            else
            {
                $scope.finalMetadataSelectedByType += "," + metaName + ":" + metaItems;
            }
        }
        $scope.finalMetadataSelectedByType += "\"";
        $scope.manifestPackageXml += '\t<version>' + $scope.apiVersion + '</version>\n';
        $scope.manifestPackageXml += '</Package>\n';

        $scope.sfdxSourceMetaCommandSuggestedText = "sfdx  force:source:retrieve --targetusername " +  $scope.userList.value + " --apiversion " + $scope.apiVersion + " --metadata " + $scope.finalMetadataSelectedByType;
        $scope.sfdxMdapiPkgCommandSuggestedText = "sfdx force:mdapi:retrieve --targetusername " +  $scope.userList.value + " --apiversion " + $scope.apiVersion + ' --unpackaged  "PathToFile"';
        $scope.sfdxSourcePkgCommandSuggestedText = "sfdx force:source:retrieve --targetusername " +  $scope.userList.value + " --apiversion " + $scope.apiVersion + ' --manifest "PathToFile"';
        $scope.$apply();
    };

    $scope.selectListed = function(value, elem) {
        var setVal = false;
        if (value == "All")
        {
            setVal = true;
        }
        for (i in $scope.metadataTypesListed)
        {
            if (elem == "global" || elem == $scope.metadataTypesListed[i].name)
            {
                for (j in $scope.metadataTypesListed[i].metadataRecords)
                {
                    $scope.metadataTypesListed[i].metadataRecords[j].selected = setVal;
                }
                if (setVal)
                {
                    $scope.selectedMetadataElems[$scope.metadataTypesListed[i].name] = $scope.metadataTypesListed[i].metadataRecords;
                }
                else
                {
                    $scope.selectedMetadataElems[$scope.metadataTypesListed[i].name] = "";
                }
            }
        }
        $scope.finalMetadataSelected();
    };

    $scope.selectMetadata = function(value) {
        var setVal = false;
        $scope.displayMetadataTypesSelected = "None";
        if (value == "All")
        {
            setVal = true;
        }

        var valuesSelected = "";
        var first = true;
        for (i in $scope.metadataTypes)
        {
            $scope.metadataTypes[i].selected = setVal;
            if (setVal)
            {
                if (first)
                {
                    valuesSelected += $scope.metadataTypes[i].metadataTypeName;
                    first = false;
                }
                else
                {
                    valuesSelected += "," + $scope.metadataTypes[i].metadataTypeName;
                }
            }
        }
        if (setVal)
        {
            $scope.displayMetadataTypesSelected = valuesSelected;
            $scope.selectedMetadataTypes = $scope.metadataTypes;
        }
        else
        {
            $scope.selectedMetadataTypes = "";
        }
        var element = $window.document.getElementById("selectedMetadataTypesId");
        element.focus();
    };

    $scope.addMetadata = function() {
        vscode.postMessage({
            command: 'addMetadata',
            text: "Add new Metadata Type"
        });
    };

    $scope.copyToClipboard = function(textToCopy) {
        vscode.postMessage({
            command: 'copyToClipboard',
            text: textToCopy
        });
    };

    $scope.previewMetadata = function() {
        $scope.metadataTypesListed = [];
        $scope.selectedMetadataElems = {};
        vscode.postMessage({
            command: 'previewMetadata',
            user: $scope.userList.value,
            metadataTypes: $scope.displayMetadataTypesSelected
        });
        $scope.$apply();
    };

    $scope.saveFile = function(data) {
        vscode.postMessage({
            command: 'saveFile',
            text: data
        });
    };
  

    window.addEventListener('message', event => {
        const message = event.data; // The json data that the extension sent
        switch (message.command) {
            case 'initMetadataTypes':
                $scope.metadataTypes = [];
                var metadataTypesRecords = message.results;
                for(i in metadataTypesRecords)
                {
                    $scope.metadataTypes.push({metadataTypeName:metadataTypesRecords[i], selected: false});
                }
                $scope.$apply(function(){ //code 
                });
                break;
            case 'initMetadataTemplates':
                $scope.metadataTemplates = [];
                var metadataTemplateRecords = message.results;
                $scope.metadataTemplatesJson = metadataTemplateRecords;
                for(i in metadataTemplateRecords.templates)
                {
                    $scope.metadataTemplates.push({metadataTemplate:metadataTemplateRecords.templates[i].name, selected: false});
                }
                $scope.$apply(function(){ //code 
                });
                break;
            case 'initApiVersion':
                $scope.apiVersion = message.results;
                $scope.$apply(function(){ //code 
                });
                break;
            case 'metadataTypeListed':
                var metadataTypeRecords = message.results;
                var found = false;
                for (i in $scope.metadataTypesListed)
                {
                    if ($scope.metadataTypesListed[i].name == message.metadataType)
                    {
                        //var currentMetas = $scope.metadataTypesListed[i].metadataRecords;
                        //Array.prototype.push.apply($scope.metadataTypesListed[i].metadataRecords, metadataTypeRecords);
                        //currentMetas.push(metadataTypeRecords);
                        $scope.metadataTypesListed[i].metadataRecords = metadataTypeRecords;
                        found = true;   
                    }
                }
                if (!found)
                {
                    $scope.metadataTypesListed.push({name: message.metadataType, expanded: true, icon: "-", metadataRecords: metadataTypeRecords});
                }
                $scope.$apply(function(){ //code 
                });
                break;
            case 'usersRetrieved':
                $scope.usersOptions = [];
                var userRecords = message.results.result;
                for(i in userRecords)
                {
                    $scope.usersOptions.push({label:userRecords[i].alias + ' - ' + userRecords[i].value, value: userRecords[i].alias});
                }
                $scope.$apply(function(){ //code 
                });
                break;
            case 'fileSaved':
                $scope.filePath = message.results;
                $scope.sfdxMdapiPkgCommandSuggestedText = "sfdx force:mdapi:retrieve --targetusername " +  $scope.userList.value + " --apiversion " + $scope.apiVersion + ' --unpackaged "' + $scope.filePath + '"';
                $scope.sfdxSourcePkgCommandSuggestedText = "sfdx force:source:retrieve --targetusername " +  $scope.userList.value + " --apiversion " + $scope.apiVersion + ' --manifest "' + $scope.filePath + '"';
                $scope.$apply(function(){ //code 
                });
                break;
        }
    });

    $scope.expandSection = function(elem) {
        elem.expanded = !elem.expanded;
        if(elem.expanded){
            elem.icon = "-";
        }
        else {
            elem.icon = "+";
        }
        $scope.$apply(function(){ //code
        });
    };

    $scope.expandAll = function() {
        for (i in $scope.metadataTypesListed)
        {
            $scope.metadataTypesListed[i].expanded = true;
            $scope.metadataTypesListed[i].icon = "-";
        }
        $scope.$apply(function(){ //code
        });
    };

    $scope.collapseAll = function() {
        for (i in $scope.metadataTypesListed)
        {
            $scope.metadataTypesListed[i].expanded = false;
            $scope.metadataTypesListed[i].icon = "+";
        }
        $scope.$apply(function(){ //code
        });
    };

    $scope.GetValue = function () {
        var message = "";
        vscode.postMessage({
            command: 'alert',
            text: message
        });
    };

    $scope.init();

});
