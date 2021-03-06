import { Injectable } from '@angular/core';
import { BanchoClient, PrivateMessage, ChannelMessage, BanchoChannel, BanchoMultiplayerChannel, BanchoLobbyPlayer } from 'bancho.js';
import { ToastService } from './toast.service';
import { StoreService } from './store.service';
import { BehaviorSubject, Observable, from } from 'rxjs';
import { Channel, TeamMode, WinCondition } from '../models/irc/channel';
import { Message } from '../models/irc/message';
import { Regex } from '../models/irc/regex';
import { MessageBuilder, MessageType } from '../models/irc/message-builder';
import { MultiplayerLobbiesService } from './multiplayer-lobbies.service';
import { Howl } from 'howler';

@Injectable({
	providedIn: 'root'
})

export class IrcService {
	client: BanchoClient;

	/**
	 * Whether or not the user is authenticated to irc
	 */
	isAuthenticated = false;

	/**
	 * The username of the authenticated user
	 */
	authenticatedUser = 'none';

	allChannels: Channel[] = [];

	// Variables to tell if we are connecting/disconnecting to irc
	isConnecting$: BehaviorSubject<boolean>;
	isDisconnecting$: BehaviorSubject<boolean>;
	isJoiningChannel$: BehaviorSubject<boolean>;
	messageHasBeenSend$: BehaviorSubject<boolean>;
	private isAuthenticated$: BehaviorSubject<boolean>;

	// Indicates if the multiplayerlobby is being created for "Create a lobby" route
	isCreatingMultiplayerLobby = -1;

	// Indication if a sound is playing or not
	private soundIsPlaying = false;

	constructor(private toastService: ToastService, private storeService: StoreService, private multiplayerLobbiesService: MultiplayerLobbiesService) {
		// Create observables for is(Dis)Connecting
		this.isConnecting$ = new BehaviorSubject<boolean>(false);
		this.isDisconnecting$ = new BehaviorSubject<boolean>(false);
		this.isJoiningChannel$ = new BehaviorSubject<boolean>(false);
		this.messageHasBeenSend$ = new BehaviorSubject<boolean>(false);
		this.isAuthenticated$ = new BehaviorSubject<boolean>(false);

		// Connect to irc if the credentials are saved
		const ircCredentials = storeService.get('irc');

		if (ircCredentials != undefined) {
			toastService.addToast('Irc credentials were found, attempting to login to irc.');
			this.connect(ircCredentials.username, ircCredentials.password);
		}

		const connectedChannels = storeService.get('irc.channels');

		if (connectedChannels != undefined && Object.keys(connectedChannels).length > 0) {
			// Loop through all the channels
			for (const channel in connectedChannels) {
				const nChannel = new Channel(connectedChannels[channel].name);
				nChannel.active = connectedChannels[channel].active;
				nChannel.lastActiveChannel = connectedChannels[channel].lastActiveChannel;
				nChannel.isPrivateChannel = connectedChannels[channel].isPrivateChannel;
				nChannel.playSoundOnMessage = (connectedChannels[channel].playSoundOnMessage ? connectedChannels[channel].playSoundOnMessage : false);

				// Loop through all the messages
				for (const message in connectedChannels[channel].messageHistory) {
					const thisMessage = connectedChannels[channel].messageHistory[message];
					const messageBuilder: MessageBuilder[] = [];

					// Loop through the message builder
					for (const messageInBuilder in thisMessage.message) {
						const thisMessageInBuilder = thisMessage.message[messageInBuilder];
						messageBuilder.push(new MessageBuilder(thisMessageInBuilder.messageType, thisMessageInBuilder.message, thisMessageInBuilder.linkName));
					}

					nChannel.allMessages.push(new Message(thisMessage.messageId, thisMessage.date, thisMessage.time, thisMessage.author, messageBuilder, false));
				}

				// Add a divider to the channel to show new messages
				nChannel.allMessages.push(new Message(null, 'n/a', 'n/a', 'Today', [new MessageBuilder(MessageType.Message, 'Messages from history')], true));

				this.allChannels.push(nChannel);
			}
		}
	}

	/**
	 * Check if we are connecting
	 */
	getIsConnecting(): Observable<boolean> {
		return this.isConnecting$.asObservable();
	}

	/**
	 * Check if we are disconnecting
	 */
	getIsDisconnecting(): Observable<boolean> {
		return this.isDisconnecting$.asObservable();
	}

	/**
	 * Check if we are joining a channel
	 */
	getIsJoiningChannel(): Observable<boolean> {
		return this.isJoiningChannel$.asObservable();
	}

	/**
	 * Check if there was a message send
	 */
	hasMessageBeenSend(): Observable<boolean> {
		return this.messageHasBeenSend$.asObservable();
	}

	/**
	 * Check if the user is authenticated
	 */
	getIsAuthenticated(): Observable<boolean> {
		return this.isAuthenticated$.asObservable();
	}

	/**
	 * Connect the user to irc
	 * @param username the username to connect with
	 * @param password the password to connect with
	 */
	connect(username: string, password: string) {
		const allJoinedChannels = this.storeService.get('irc.channels');
		const apiKey = this.storeService.get('api-key')

		this.client = new BanchoClient({ username: username, password: password, apiKey: apiKey });

		this.isConnecting$.next(true);

		/**
		 * Message handler
		 */
		this.client.on('PM', (message: PrivateMessage) => {
			if (message.self != true)
				this.addMessageToChannel(message.user.ircUsername, message.recipient.ircUsername, message.content, false);
		});

		this.client.on('CM', (message: ChannelMessage) => {
			this.sendChannelMessage(message);

			// Make sure message is send in a multiplayer channel as well as by BanchoBot
			if (message.channel.name.startsWith('#mp_') && message.user.ircUsername == 'BanchoBot') {
				const multiplayerInitialization = Regex.multiplayerInitialization.run(message.message);
				const multiplayerSettingsChange = Regex.multiplayerSettingsChange.run(message.message);
				const matchClosed = Regex.closedMatch.run(message.message);
				const playerInSlot = Regex.playerInSlot.run(message.message);

				// Initialize the channel with the correct teammode and wincondition
				if (multiplayerInitialization) {
					this.getChannelByName(message.channel.name).teamMode = TeamMode[multiplayerInitialization.teamMode];
					this.getChannelByName(message.channel.name).winCondition = WinCondition[multiplayerInitialization.winCondition];
				}

				// The room was changed by "!mp set x x x"
				if (multiplayerSettingsChange) {
					this.getChannelByName(message.channel.name).players = multiplayerSettingsChange.size;
					this.getChannelByName(message.channel.name).teamMode = TeamMode[multiplayerSettingsChange.teamMode];
					this.getChannelByName(message.channel.name).winCondition = WinCondition[multiplayerSettingsChange.winCondition];
				}

				// The match was closed
				if (matchClosed) {
					this.changeActiveChannel(this.getChannelByName(message.channel.name), false);
					this.getChannelByName(message.channel.name).active = false;
				}

				// Gets called when !mp settings is ran
				if (playerInSlot) {
					this.multiplayerLobbiesService.getByIrcLobby(message.channel.name).multiplayerLobbyPlayers.playerChanged(playerInSlot);
				}
			}
		});

		this.client.on('nochannel', (channel: BanchoChannel) => {
			if (this.getChannelByName(channel.name) != null) {
				this.getChannelByName(channel.name).active = false;
				this.changeActiveChannel(this.getChannelByName(channel.name), false);
			}
		});

		from(this.client.connect()).subscribe(() => {
			this.isAuthenticated = true;
			this.authenticatedUser = username;

			// Save the credentials
			this.storeService.set('irc.username', username);
			this.storeService.set('irc.password', password);

			this.isConnecting$.next(false);

			this.isAuthenticated$.next(true);

			this.toastService.addToast('Successfully connected to irc!');

			// Initialize multiplayer channels after restart
			for (const ircChannel in allJoinedChannels) {
				if (allJoinedChannels[ircChannel].isPrivateChannel == false) {
					const channel = this.client.getChannel(allJoinedChannels[ircChannel].name) as BanchoMultiplayerChannel;
					from(channel.join()).subscribe(() => {
						this.initializeChannelListeners(channel);
					});
				}
			}
		});
	}

	/**
	 * Initialize the channel listeners when connecting to a channel
	 * @param channel
	 */
	initializeChannelListeners(channel: BanchoMultiplayerChannel) {
		channel.lobby.on('playerMoved', (obj: { player: BanchoLobbyPlayer, slot: number }) => {
			this.multiplayerLobbiesService.getByIrcLobby(channel.name).multiplayerLobbyPlayers.movePlayerToSlot(obj);
		});

		channel.lobby.on('playerJoined', (obj: { player: BanchoLobbyPlayer, slot: number, team: string }) => {
			this.multiplayerLobbiesService.getByIrcLobby(channel.name).multiplayerLobbyPlayers.playerJoined(obj);
		});

		channel.lobby.on('playerLeft', (player: BanchoLobbyPlayer) => {
			this.multiplayerLobbiesService.getByIrcLobby(channel.name).multiplayerLobbyPlayers.playerLeft(player);
		})

		channel.lobby.on('playerChangedTeam', (obj: { player: BanchoLobbyPlayer, team: string }) => {
			this.multiplayerLobbiesService.getByIrcLobby(channel.name).multiplayerLobbyPlayers.playerChangedTeam(obj);
		});

		channel.lobby.on('hostCleared', () => {
			this.multiplayerLobbiesService.getByIrcLobby(channel.name).multiplayerLobbyPlayers.clearMatchHost();
		});

		channel.lobby.on('host', (player: BanchoLobbyPlayer) => {
			this.multiplayerLobbiesService.getByIrcLobby(channel.name).multiplayerLobbyPlayers.changeHost(player);
		});

		channel.lobby.on('matchFinished', () => {
			this.multiplayerLobbiesService.synchronizeMultiplayerMatch(this.multiplayerLobbiesService.getByIrcLobby(channel.name), true, true);
		});

		channel.lobby.on('size', (size: number) => {
			this.getChannelByName(channel.name).players = size;
		});
	}

	/**
	 * Disconnect the user from irc
	 */
	disconnect() {
		if (this.isAuthenticated) {
			this.client.removeAllListeners();

			this.isDisconnecting$.next(true);

			this.client.disconnect();

			this.isAuthenticated = false;
			this.authenticatedUser = 'none';

			// Delete the credentials
			this.storeService.delete('irc');

			this.isDisconnecting$.next(false);

			this.toastService.addToast('Successfully disconnected from irc.');
		}
	}

	/**
	 * Get the channel by its name
	 * @param channelName the channelname
	 */
	getChannelByName(channelName: string) {
		let channel: Channel = null;
		for (const i in this.allChannels) {
			if (this.allChannels[i].channelName == channelName) {
				channel = this.allChannels[i];
				break;
			}
		}

		return channel;
	}

	/**
	 * Add a message to the appropriate channel
	 * @param user the user that is sending the message
	 * @param recipient the user that is receiving the message
	 * @param message the message it self
	 * @param isSending if the message is being send or being received
	 */
	addMessageToChannel(user: string, recipient: string, message: string, isSending: boolean) {
		const date = new Date();
		const timeFormat = `${(date.getHours() <= 9 ? '0' : '')}${date.getHours()}:${(date.getMinutes() <= 9 ? '0' : '')}${date.getMinutes()}`;
		const dateFormat = `${(date.getDate() <= 9 ? '0' : '')}${date.getDate()}/${(date.getMonth() <= 9 ? '0' : '')}${date.getMonth()}/${date.getFullYear()}`;

		let newMessage: Message;

		// ===============================
		// The user is sending the message
		if (isSending == true) {
			// Join channel if you haven't joined it yet
			if (this.getChannelByName(recipient) == null) {
				this.joinChannel(recipient);
			}

			newMessage = new Message(Object.keys(this.getChannelByName(recipient).allMessages).length + 1, dateFormat, timeFormat, user, this.buildMessage(message), false);

			this.getChannelByName(recipient).allMessages.push(newMessage);
			this.getChannelByName(recipient).hasUnreadMessages = true;
			this.saveMessageToHistory(recipient, newMessage);
		}
		// =============================
		// The message is being received
		else {
			const messageId = this.getChannelByName(user) == null ? 0 : Object.keys(this.getChannelByName(user).allMessages).length + 1;

			if (user.startsWith('#mp_')) {
				newMessage = new Message(messageId, dateFormat, timeFormat, recipient, this.buildMessage(message), false);
			}
			else {
				newMessage = new Message(messageId, dateFormat, timeFormat, user, this.buildMessage(message), false);
			}

			// Join channel if you haven't joined it yet
			if (this.getChannelByName(user) == null) {
				this.joinChannel(user);
			}

			this.getChannelByName(user).allMessages.push(newMessage);
			this.getChannelByName(user).hasUnreadMessages = true;
			this.saveMessageToHistory(user, newMessage);

			if (this.getChannelByName(user).playSoundOnMessage) {
				const sound = new Howl({
					src: ['assets/stairs.mp3'],
				});

				if (!this.soundIsPlaying) {
					sound.play();
					this.soundIsPlaying = true;
				}

				sound.on('end', () => {
					this.soundIsPlaying = false;
				});
			}
		}

		this.messageHasBeenSend$.next(true);
	}

	/**
	 * Join a
	 * @param channelName
	 */
	joinChannel(channelName: string) {
		const allJoinedChannels = this.storeService.get('irc.channels');
		this.isJoiningChannel$.next(true);

		// Check if you have already joined the channel
		if (allJoinedChannels != undefined && allJoinedChannels.hasOwnProperty(channelName)) {
			this.toastService.addToast(`You have already joined the channel "${channelName}".`);
			this.isJoiningChannel$.next(false);
			return;
		}

		// ===================================
		// Joining a multiplayer match channel
		if (channelName.startsWith('#mp_')) {
			this.storeService.set(`irc.channels.${channelName}`, {
				name: channelName,
				active: true,
				messageHistory: [],
				lastActiveChannel: false,
				isPrivateChannel: false,
				playSoundOnMessage: false
			});

			this.allChannels.push(new Channel(channelName));
			this.toastService.addToast(`Joined channel "${channelName}".`);

			this.isJoiningChannel$.next(false);
		}
		// =======================================
		// Joining a non multiplayer match channel
		else {
			const getChannel = this.getChannelByName(channelName);

			if (getChannel == null) {
				this.storeService.set(`irc.channels.${channelName}`, {
					name: channelName,
					active: true,
					messageHistory: [],
					lastActiveChannel: false,
					isPrivateChannel: true,
					playSoundOnMessage: false
				});

				this.allChannels.push(new Channel(channelName, true));
				this.toastService.addToast(`Opened private message channel with "${channelName}".`);
			}

			this.isJoiningChannel$.next(false);
		}
	}

	/**
	 * Send a message to the given channelmessage
	 * @param message
	 */
	sendChannelMessage(message: ChannelMessage) {
		// Message is send from ingame
		if (message.self == false) {
			this.addMessageToChannel(message.channel.name, message.user.ircUsername, message.message, false);
		}
	}

	/**
	 * Part from the given channel
	 * @param channelName the channel to part
	 */
	partChannel(channelName: string) {
		const allJoinedChannels = this.storeService.get('irc.channels');

		if (allJoinedChannels.hasOwnProperty(channelName)) {
			for (const i in this.allChannels) {
				if (this.allChannels[i].channelName == channelName) {
					this.allChannels.splice(parseInt(i), 1);
					break;
				}
			}

			if (channelName.startsWith('#')) {
				this.client.getChannel(channelName).leave();
			}

			delete allJoinedChannels[channelName];

			this.storeService.set('irc.channels', allJoinedChannels);
			this.toastService.addToast(`Successfully parted "${channelName}".`);
		}
	}

	/**
	 * Send a message to the said channel
	 * @param channelName the channel to send the message in
	 * @param message the message to send
	 */
	sendMessage(channelName: string, message: string) {
		this.addMessageToChannel(this.authenticatedUser, channelName, message, true);

		if (channelName.startsWith('#')) {
			this.client.getChannel(channelName).sendMessage(message);
		}
		else {
			this.client.getUser(channelName).sendMessage(message);
		}
	}

	/**
	 * Save the rearranged channels
	 * @param channels the rearranged channels
	 */
	rearrangeChannels(channels: Channel[]) {
		const rearrangedChannels = {};

		for (const i in channels) {
			rearrangedChannels[channels[i].channelName] = {
				name: channels[i].channelName,
				active: channels[i].active,
				messageHistory: channels[i].allMessages.filter(m => !m.isADivider),
				lastActiveChannel: channels[i].lastActiveChannel,
				isPrivateChannel: channels[i].isPrivateChannel
			};
		}

		this.storeService.set('irc.channels', rearrangedChannels);
	}

	/**
	 * Change the last active status in the store for the given channel
	 * @param channel the channel to change the status of
	 * @param active the status
	 */
	changeLastActiveChannel(channel: Channel, active: boolean) {
		const storeChannel = this.storeService.get(`irc.channels.${channel.channelName}`);

		storeChannel.lastActiveChannel = active;

		this.storeService.set(`irc.channels.${channel.channelName}`, storeChannel);
	}

	/**
	 * Change the active status in the store for the given channel
	 * @param channel the channel to change the status of
	 * @param active the status
	 */
	changeActiveChannel(channel: Channel, active: boolean) {
		const storeChannel = this.storeService.get(`irc.channels.${channel.channelName}`);

		storeChannel.active = active;

		this.storeService.set(`irc.channels.${channel.channelName}`, storeChannel);
	}

	/**
	 * Save the message in the channel history
	 * @param channelName the channel to save it in
	 * @param message the message object to save
	 */
	saveMessageToHistory(channelName: string, message: Message) {
		if (message.isADivider) return;

		const storeChannel = this.storeService.get(`irc.channels.${channelName}`);
		storeChannel.messageHistory.push(message.convertToJson());
		this.storeService.set(`irc.channels.${channelName}`, storeChannel);
	}

	/**
	 * Build a message with the appropriate hyperlinks
	 * @param message the message to build
	 */
	buildMessage(message: string): MessageBuilder[] {
		const messageBuilder: MessageBuilder[] = [];

		const allRegexes = [
			Regex.isListeningTo,
			Regex.isWatching,
			Regex.isPlaying,
			Regex.isEditing,
			Regex.playerBeatmapChange
		];

		let regexSucceeded = false;

		// Handle all the regexes
		for (const regex in allRegexes) {
			const currentRegex = allRegexes[regex].run(message);

			if (currentRegex != null) {
				messageBuilder.push(new MessageBuilder(MessageType.Message, currentRegex.message));
				messageBuilder.push(new MessageBuilder(MessageType.Link, currentRegex.link, currentRegex.name));

				regexSucceeded = true;
			}
		}

		// Handle messages that do not match any of the regexes
		if (!regexSucceeded) {
			const isLinkRegex = Regex.isLink.run(message);
			const isEmbedRegex = Regex.isEmbedLink.run(message);

			// Embed link
			if (isEmbedRegex != null) {
				const splittedString = message.split(Regex.isEmbedLink.regexFullEmbed).filter(s => s != '' && s.trim());

				if (splittedString.length == 1) {
					const linkSplit = splittedString[0].split(Regex.isEmbedLink.regexSplit).filter(s => s != '' && s.trim());

					messageBuilder.push(new MessageBuilder(MessageType.Link, linkSplit[0], linkSplit[1]));
				}
				else {
					for (const split in splittedString) {
						// The split is a link
						if (Regex.isEmbedLink.run(splittedString[split])) {
							const linkSplit = splittedString[split].split(Regex.isEmbedLink.regexSplit).filter(s => s != '' && s.trim());

							messageBuilder.push(new MessageBuilder(MessageType.Link, linkSplit[0], linkSplit[1]));
						}
						// The split is a message
						else {
							messageBuilder.push(new MessageBuilder(MessageType.Message, splittedString[split]));
						}
					}
				}
			}
			// Check if there is a link
			else if (isLinkRegex != null) {
				const splittedString = message.split(Regex.isLink.regex).filter(s => s != '' && s.trim());

				if (splittedString.length == 1) {
					messageBuilder.push(new MessageBuilder(MessageType.Link, splittedString[0]));
				}
				else {
					for (const split in splittedString) {
						// The split is a link
						if (Regex.isLink.run(splittedString[split])) {
							messageBuilder.push(new MessageBuilder(MessageType.Link, splittedString[split]));
						}
						// The split is a message
						else {
							messageBuilder.push(new MessageBuilder(MessageType.Message, splittedString[split]));
						}
					}
				}
			}
			else {
				messageBuilder.push(new MessageBuilder(MessageType.Message, message));
			}
		}

		return messageBuilder;
	}
}
