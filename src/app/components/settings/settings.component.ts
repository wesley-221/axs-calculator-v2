import { Component, OnInit } from '@angular/core';
import { ElectronService } from '../../services/electron.service';
import { StoreService } from '../../services/store.service';
import { ToastService } from '../../services/toast.service';
import { ToastType } from '../../models/toast';
import { ApiKeyValidation } from '../../services/osu-api/api-key-validation.service';
import { MatDialog } from '@angular/material/dialog';
import { RemoveSettingsComponent } from '../dialogs/remove-settings/remove-settings.component';
import { AuthenticateService } from 'app/services/authenticate.service';
import { IrcService } from 'app/services/irc.service';
import { FormGroup, FormControl, Validators } from '@angular/forms';
import { RegisterRequest } from 'app/models/authentication/register-request';
import { OauthService } from 'app/services/oauth.service';
import { Oauth } from 'app/models/authentication/oauth';
import { GenericService } from 'app/services/generic.service';

@Component({
	selector: 'app-settings',
	templateUrl: './settings.component.html',
	styleUrls: ['./settings.component.scss']
})

export class SettingsComponent implements OnInit {
	apiKey: string;

	dialogMessage: string;
	dialogAction = 0;

	mappoolPublishForm: FormGroup;
	ircLoginForm: FormGroup;

	isConnecting = false;
	isDisconnecting = false;

	apiKeyIsValid = false;

	axsMenuStatus: boolean;

	allOptions: { icon: string, message: string, buttonText: string, action: any }[] = [
		{ icon: 'settings', message: 'This will export the config file and save it as a file in case you need to share it with someone. <br /><b>Note:</b> This will not export any authentication data such as login information or API keys <br />', buttonText: 'Export config file', action: () => this.exportConfigFile() },
		{ icon: 'cached', message: 'This will clear all the cache.', buttonText: 'Clear cache', action: () => this.openDialog(0) },
		{ icon: 'api', message: 'This will remove the API key.', buttonText: 'Remove API key', action: () => this.openDialog(1) },
		{ icon: 'settings', message: 'Show or hide the AxS menu item.', buttonText: 'Toggle', action: () => this.toggleAxSMenu() }
	];

	constructor(
		public electronService: ElectronService,
		private storeService: StoreService,
		private toastService: ToastService,
		private apiKeyValidation: ApiKeyValidation,
		private dialog: MatDialog,
		public auth: AuthenticateService,
		public ircService: IrcService,
		private oauthService: OauthService,
		private genericService: GenericService
	) {
		this.apiKey = this.storeService.get('api-key');

		if (this.apiKey && this.apiKey.length > 0) {
			this.apiKeyIsValid = true;
		}

		this.genericService.getAxSMenuStatus().subscribe(status => {
			this.axsMenuStatus = status;
		});
	}

	ngOnInit() {
		this.mappoolPublishForm = new FormGroup({
			'username': new FormControl('', [
				Validators.required
			]),
			'password': new FormControl('', [
				Validators.required
			])
		});

		this.ircLoginForm = new FormGroup({
			'irc-username': new FormControl('', [
				Validators.required
			]),
			'irc-password': new FormControl('', [
				Validators.required
			])
		});

		// Subscribe to the isConnecting variable to show/hide the spinner
		this.ircService.getIsConnecting().subscribe(value => {
			this.isConnecting = value;
		});

		// Subscribe to the isConnecting variable to show/hide the spinner
		this.ircService.getIsDisconnecting().subscribe(value => {
			this.isDisconnecting = value;
		});
	}

	/**
	 * Login the user with the given username and password
	 */
	loginMappoolPublish() {
		const username = this.mappoolPublishForm.get('username').value;
		const password = this.mappoolPublishForm.get('password').value;

		const registerUser = new RegisterRequest();

		registerUser.username = username;
		registerUser.password = password;

		this.auth.login(registerUser).subscribe((oauth: Oauth) => {
			this.oauthService.cacheOauth(oauth);
			this.oauthService.oauth = oauth;

			this.oauthService.setOauthHasBeenLoaded(true);
		}, (err) => {
			if (err.status == 0) {
				this.toastService.addToast(`${err.statusText}. Server might be offline due to maintenance.`, ToastType.Error);
			}
			else {
				this.toastService.addToast(`${err.error.message}`, ToastType.Error);
			}
		});
	}

	logoutMappoolPublish() {
		this.auth.logout();
		this.toastService.addToast('Successfully logged out.');
	}

	/**
	 * Login to irc with the given credentials
	 */
	connectIrc() {
		const username = this.ircLoginForm.get('irc-username').value;
		const password = this.ircLoginForm.get('irc-password').value;

		this.ircService.connect(username, password);
	}

	disconnectIrc() {
		this.ircService.disconnect();
	}

	/**
	 * Get the api key
	 */
	getApiKey() {
		return this.storeService.get('api-key');
	}

	/**
	 * Save the api key with the entered value
	 */
	saveApiKey() {
		// Key is valid
		this.apiKeyValidation.validate(this.apiKey).subscribe(() => {
			this.storeService.set('api-key', this.apiKey);
			this.toastService.addToast('You have entered a valid api-key.', ToastType.Information);

			this.apiKeyIsValid = true;
		},
			// Key is invalid
			() => {
				this.toastService.addToast('The entered api-key was invalid.', ToastType.Error);
			});
	}

	/**
	 * Clear the cache
	 */
	clearCache() {
		this.storeService.delete('cache');
		this.toastService.addToast('Successfully cleared the cache.');
	}

	/**
	 * Remove the pai key
	 */
	removeApiKey() {
		this.storeService.delete('api-key');
		this.toastService.addToast('Successfully removed your api key.');

		this.apiKeyIsValid = false;
		this.apiKey = null;
	}

	/**
	 * Export the config file
	 */
	exportConfigFile() {
		this.electronService.dialog.showSaveDialog({
			title: 'Export the config file',
			defaultPath: 'export.json'
		}).then(file => {
			// Remove the api key and auth properties
			let configFile = this.storeService.storage.store;
			configFile['api-key'] = 'redacted';
			configFile['auth'] = 'redacted'; // Authentication details from older versions
			configFile['oauth'] = 'redacted';
			configFile['irc']['username'] = 'redacted';
			configFile['irc']['password'] = 'redacted';

			configFile = JSON.stringify(configFile, null, '\t');

			this.electronService.fs.writeFile(file.filePath, configFile, err => {
				if (err) {
					this.toastService.addToast(`Something went wrong while trying to export the config file: ${err.message}.`, ToastType.Error);
				}
				else {
					this.toastService.addToast(`Successfully saved the config file to "${file.filePath}".`);
				}
			});
		});
	}

	openDialog(dialogAction: number) {
		let dialogMessage: string = null;

		if (dialogAction == 0) {
			dialogMessage = 'Are you sure you want to clear your cache?';
		}
		else if (dialogAction == 1) {
			dialogMessage = 'Are you sure you want to remove your api key?';
		}

		const dialogRef = this.dialog.open(RemoveSettingsComponent, {
			data: {
				message: dialogMessage
			}
		});

		dialogRef.afterClosed().subscribe(res => {
			if (res == true) {
				if (dialogAction == 0) {
					this.clearCache();
				}
				else if (dialogAction == 1) {
					this.removeApiKey();
				}
			}
		});
	}

	toggleAxSMenu(): void {
		this.axsMenuStatus = !this.axsMenuStatus;
		this.genericService.setAxSMenu(this.axsMenuStatus);
	}
}
