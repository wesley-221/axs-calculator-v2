import { Component, OnInit, ViewChild, ElementRef } from '@angular/core';
import { IrcService } from '../../services/irc.service';
import { Channel } from '../../models/irc/channel';
import { Message } from '../../models/irc/message';
import { ElectronService } from '../../services/electron.service';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { VirtualScrollerComponent } from 'ngx-virtual-scroller';
import { MappoolService } from '../../services/mappool.service';
import { ModBracketMap } from '../../models/osu-mappool/mod-bracket-map';
import { ModBracket } from '../../models/osu-mappool/mod-bracket';
import { MultiplayerLobbiesService } from '../../services/multiplayer-lobbies.service';
import { Router } from '@angular/router';
import { ToastService } from '../../services/toast.service';
import { StoreService } from '../../services/store.service';
import { MultiplayerLobby } from '../../models/store-multiplayer/multiplayer-lobby';
import { Mappool } from '../../models/osu-mappool/mappool';
import { ToastType } from '../../models/toast';
import { WebhookService } from '../../services/webhook.service';
import { MatDialog } from '@angular/material/dialog';
import { JoinIrcChannelComponent } from '../dialogs/join-irc-channel/join-irc-channel.component';
import { MatSelectChange, MatSelect } from '@angular/material/select';
import { BanBeatmapComponent } from '../dialogs/ban-beatmap/ban-beatmap.component';
import { MultiplayerLobbyPlayersPlayer } from 'app/models/mutliplayer-lobby-players/multiplayer-lobby-players-player';
import { MultiplayerLobbyMovePlayerComponent } from '../dialogs/multiplayer-lobby-move-player/multiplayer-lobby-move-player.component';
import { MultiplayerLobbyPlayers } from 'app/models/mutliplayer-lobby-players/multiplayer-lobby-players';
import { SendBeatmapResultComponent } from '../dialogs/send-beatmap-result/send-beatmap-result.component';

export interface BanBeatmapDialogData {
	beatmap: ModBracketMap;
	modBracket: ModBracket;
	multiplayerLobby: MultiplayerLobby;

	banForTeam: string;
}

export interface MultiplayerLobbyMovePlayerDialogData {
	allPlayers: MultiplayerLobbyPlayers;
	movePlayer: MultiplayerLobbyPlayersPlayer;
	moveToSlot: number;
}

export interface SendBeatmapResultDialogData {
	multiplayerLobby: MultiplayerLobby;
	ircChannel: string;
}

@Component({
	selector: 'app-irc',
	templateUrl: './irc.component.html',
	styleUrls: ['./irc.component.scss']
})
export class IrcComponent implements OnInit {
	@ViewChild('channelName') channelName: ElementRef;
	@ViewChild('chatMessage') chatMessage: ElementRef;

	@ViewChild(VirtualScrollerComponent, { static: true }) private virtualScroller: VirtualScrollerComponent;

	selectedChannel: Channel;
	selectedLobby: MultiplayerLobby;
	channels: Channel[];

	chats: Message[] = [];
	viewPortItems: Message[];

	chatLength = 0;
	keyPressed = false;

	isAttemptingToJoin = false;
	attemptingToJoinChannel: string;

	isOptionMenuMinimized = true;
	isPlayerManagementMinimized = true;

	@ViewChild('teamMode') teamMode: MatSelect;
	@ViewChild('winCondition') winCondition: MatSelect;
	@ViewChild('players') players: MatSelect;

	searchValue: string;

	roomSettingGoingOn = false;
	roomSettingDelay = 3;

	teamOneScore = 0;
	teamTwoScore = 0;
	nextPick: string = null;
	matchpoint: string = null;
	hasWon: string = null;

	popupBannedMap: ModBracketMap = null;
	popupBannedBracket: ModBracket = null;

	constructor(
		public electronService: ElectronService,
		public ircService: IrcService,
		private storeService: StoreService,
		public mappoolService: MappoolService,
		private multiplayerLobbies: MultiplayerLobbiesService,
		private router: Router,
		private toastService: ToastService,
		private webhookService: WebhookService,
		private dialog: MatDialog) {
		this.channels = ircService.allChannels;

		this.ircService.getIsAuthenticated().subscribe(isAuthenticated => {
			// Check if the user was authenticated
			if (isAuthenticated) {
				for (const channel in this.channels) {
					// Change the channel if it was the last active channel
					if (this.channels[channel].lastActiveChannel) {
						this.changeChannel(this.channels[channel].channelName, true);
						break;
					}
				}
			}
		});

		// Initialize the scroll
		this.ircService.hasMessageBeenSend().subscribe(() => {
			if (!this.viewPortItems) {
				return;
			}

			if (this.viewPortItems[this.viewPortItems.length - 1] === this.chats[this.chats.length - 2]) {
				this.scrollToTop();
			}

			if (this.selectedChannel && ircService.getChannelByName(this.selectedChannel.channelName).hasUnreadMessages) {
				ircService.getChannelByName(this.selectedChannel.channelName).hasUnreadMessages = false;
			}
		});
	}

	ngOnInit() {
		this.ircService.getIsJoiningChannel().subscribe(value => {
			this.isAttemptingToJoin = value;
		});
	}

	/**
	 * Change the channel
	 * @param channel the channel to change to
	 */
	changeChannel(channel: string, delayScroll = false) {
		if (this.selectedChannel != undefined) {
			this.selectedChannel.lastActiveChannel = false;
			this.ircService.changeLastActiveChannel(this.selectedChannel, false);
		}

		this.selectedChannel = this.ircService.getChannelByName(channel);
		this.selectedLobby = this.multiplayerLobbies.getByIrcLobby(channel);

		this.selectedChannel.lastActiveChannel = true;
		this.ircService.changeLastActiveChannel(this.selectedChannel, true);

		this.selectedChannel.hasUnreadMessages = false;
		this.chats = this.selectedChannel.allMessages;

		this.multiplayerLobbies.synchronizeIsCompleted().subscribe(data => {
			if (data != -1) {
				this.refreshIrcHeader(this.multiplayerLobbies.get(data));
			}
		});

		if (this.selectedLobby != undefined) {
			this.teamOneScore = this.selectedLobby.teamOneScore;
			this.teamTwoScore = this.selectedLobby.teamTwoScore;
			this.nextPick = this.selectedLobby.getNextPickName();
			this.matchpoint = this.selectedLobby.getMatchpoint();
			this.hasWon = this.selectedLobby.getHasWon();
		}

		// Scroll to the bottom - delay it by 500 ms or do it instantly
		if (delayScroll) {
			setTimeout(() => {
				this.scrollToTop();
			}, 500);
		}
		else {
			this.scrollToTop();
		}

		// Reset search bar
		this.searchValue = '';
	}

	/**
	 * Attempt to join a channel
	 */
	joinChannel() {
		const dialogRef = this.dialog.open(JoinIrcChannelComponent);

		dialogRef.afterClosed().subscribe(result => {
			if (result) {
				this.attemptingToJoinChannel = result;
				this.ircService.joinChannel(result);
			}
		});
	}

	/**
	 * Part from a channel
	 * @param channelName the channel to part
	 */
	partChannel(channelName: string) {
		this.ircService.partChannel(channelName);

		if (this.selectedChannel != undefined && (this.selectedChannel.channelName == channelName)) {
			this.selectedChannel = undefined;
			this.chats = [];
		}
	}

	/**
	 * Send the entered message to the selected channel
	 */
	sendMessage(event: KeyboardEvent) {
		if (event.key == 'Enter') {
			if (this.chatMessage.nativeElement.value != '') {
				this.ircService.sendMessage(this.selectedChannel.channelName, this.chatMessage.nativeElement.value);
				this.chatMessage.nativeElement.value = '';
			}
		}
	}

	/**
	 * Drop a channel to rearrange it
	 * @param event
	 */
	dropChannel(event: CdkDragDrop<Channel[]>) {
		moveItemInArray(this.channels, event.previousIndex, event.currentIndex);

		this.ircService.rearrangeChannels(this.channels);
	}

	/**
	 * Open the link to the users userpage
	 * @param username
	 */
	openUserpage(username: string) {
		this.electronService.openLink(`https://osu.ppy.sh/users/${username}`);
	}

	/**
	 * Change the current mappool
	 * @param event
	 */
	onMappoolChange(event: MatSelectChange) {
		this.selectedLobby.mappool = this.mappoolService.getMappool(event.value);
		this.selectedLobby.mappoolId = this.mappoolService.getMappool(event.value).id;

		this.multiplayerLobbies.update(this.selectedLobby);
	}

	/**
	 * Pick a beatmap from the given bracket
	 * @param beatmap the picked beatmap
	 * @param bracket the bracket where the beatmap is from
	 */
	pickBeatmap(beatmap: ModBracketMap, bracket: ModBracket, gamemode: number = null) {
		this.ircService.sendMessage(this.selectedChannel.channelName, `!mp map ${beatmap.beatmapId} ${(gamemode != null ? gamemode : beatmap.gamemodeId)}`);

		let modBit = 0;
		let freemodEnabled = false;

		for (const mod in bracket.mods) {
			if (bracket.mods[mod].modValue != 'freemod') {
				modBit += parseInt(bracket.mods[mod].modValue);
			}
			else {
				freemodEnabled = true;
			}
		}

		// Add an extra null check
		if (this.selectedLobby.teamOnePicks == null) {
			this.selectedLobby.teamOnePicks = [];
		}

		if (this.selectedLobby.teamTwoPicks == null) {
			this.selectedLobby.teamTwoPicks = [];
		}

		// Update picks
		if (this.selectedLobby.teamOneName == this.nextPick) {
			this.selectedLobby.teamOnePicks.push(beatmap.beatmapId);
		}
		else {
			this.selectedLobby.teamTwoPicks.push(beatmap.beatmapId);
		}

		this.multiplayerLobbies.update(this.selectedLobby);

		// Reset all mods if the freemod is being enabled
		if (freemodEnabled) {
			this.ircService.sendMessage(this.selectedChannel.channelName, '!mp mods none');
		}

		this.ircService.sendMessage(this.selectedChannel.channelName, `!mp mods ${modBit}${freemodEnabled ? ' freemod' : ''}`);
	}

	/**
	 * Unpick a beatmap
	 * @param beatmap
	 * @param bracket
	 */
	unpickBeatmap(beatmap: ModBracketMap, bracket: ModBracket) {
		if (this.selectedLobby.teamOnePicks.indexOf(beatmap.beatmapId) > -1) {
			this.selectedLobby.teamOnePicks.splice(this.selectedLobby.teamOnePicks.indexOf(beatmap.beatmapId), 1);
		}
		else if (this.selectedLobby.teamTwoPicks.indexOf(beatmap.beatmapId) > -1) {
			this.selectedLobby.teamTwoPicks.splice(this.selectedLobby.teamTwoPicks.indexOf(beatmap.beatmapId), 1);
		}

		this.multiplayerLobbies.update(this.selectedLobby);
	}

	/**
	 * Change what team picked the map
	 * @param beatmap
	 * @param bracket
	 */
	changePickedBy(beatmap: ModBracketMap, bracket: ModBracket) {
		if (this.selectedLobby.teamOnePicks.indexOf(beatmap.beatmapId) > -1) {
			this.selectedLobby.teamOnePicks.splice(this.selectedLobby.teamOnePicks.indexOf(beatmap.beatmapId), 1);
			this.selectedLobby.teamTwoPicks.push(beatmap.beatmapId);
		}
		else if (this.selectedLobby.teamTwoPicks.indexOf(beatmap.beatmapId) > -1) {
			this.selectedLobby.teamTwoPicks.splice(this.selectedLobby.teamTwoPicks.indexOf(beatmap.beatmapId), 1);
			this.selectedLobby.teamOnePicks.push(beatmap.beatmapId);
		}

		this.multiplayerLobbies.update(this.selectedLobby);
	}

	/**
	 * Change the room settings
	 */
	onRoomSettingChange() {
		if (!this.roomSettingGoingOn) {
			const timer =
				setInterval(() => {
					if (this.roomSettingDelay == 0) {
						this.ircService.sendMessage(this.selectedChannel.channelName, `!mp set ${this.teamMode.value} ${this.winCondition.value} ${this.players.value}`);

						this.ircService.getChannelByName(this.selectedChannel.channelName).teamMode = this.teamMode.value;
						this.ircService.getChannelByName(this.selectedChannel.channelName).winCondition = this.winCondition.value;
						this.ircService.getChannelByName(this.selectedChannel.channelName).players = this.players.value;

						this.roomSettingGoingOn = false;
						clearInterval(timer);
					}

					this.roomSettingDelay--;
				}, 1000);

			this.roomSettingGoingOn = true;
		}

		this.roomSettingDelay = 3;
	}

	/**
	 * Navigate to the lobbyoverview from irc
	 */
	navigateLobbyOverview() {
		const lobbyId = this.multiplayerLobbies.getByIrcLobby(this.selectedChannel.channelName).lobbyId;

		if (lobbyId) {
			this.router.navigate(['/lobby-overview/lobby-view', lobbyId]);
		}
		else {
			this.toastService.addToast('No lobby overview found for this irc channel');
		}
	}

	/**
	 * Refresh the stats for a multiplayer lobby.
	 * @param multiplayerLobby the multiplayerlobby
	 */
	refreshIrcHeader(multiplayerLobby: MultiplayerLobby) {
		this.teamOneScore = multiplayerLobby.teamOneScore;
		this.teamTwoScore = multiplayerLobby.teamTwoScore;
		this.nextPick = multiplayerLobby.getNextPickName();
		this.matchpoint = multiplayerLobby.getMatchpoint();
		this.hasWon = multiplayerLobby.getHasWon();
	}

	/**
	 * Play a sound when a message is being send to a specific channel
	 * @param channel the channel that should where a message should be send from
	 * @param status mute or unmute the sound
	 */
	playSound(channel: Channel, status: boolean) {
		channel.playSoundOnMessage = status;
		this.storeService.set(`irc.channels.${channel.channelName}.playSoundOnMessage`, status);
		this.toastService.addToast(`${channel.channelName} will ${status == false ? 'no longer beep on message' : 'now beep on message'}.`);
	}

	/**
	 * Ban a beatmap
	 */
	banBeatmap(beatmap: ModBracketMap, modBracket: ModBracket, multiplayerLobby: MultiplayerLobby) {
		const dialogRef = this.dialog.open(BanBeatmapComponent, {
			data: {
				beatmap: beatmap,
				modBracket: modBracket,
				multiplayerLobby: multiplayerLobby
			}
		});

		dialogRef.afterClosed().subscribe((result: BanBeatmapDialogData) => {
			if (result != null) {
				if (result.banForTeam == result.multiplayerLobby.teamOneName) {
					this.selectedLobby.teamOneBans.push(result.beatmap.beatmapId);
					this.webhookService.sendBanResult(result.multiplayerLobby, result.multiplayerLobby.teamOneName, result.beatmap, this.ircService.authenticatedUser).subscribe();
				}
				else {
					this.selectedLobby.teamTwoBans.push(result.beatmap.beatmapId);
					this.webhookService.sendBanResult(result.multiplayerLobby, result.multiplayerLobby.teamTwoName, result.beatmap, this.ircService.authenticatedUser).subscribe();
				}

				this.multiplayerLobbies.update(this.selectedLobby);
			}
		});
	}

	/**
	 * Check if a beatmap is banned int he current lobby
	 * @param multiplayerLobby the multiplayerlobby to check from
	 * @param beatmapId the beatmap to check
	 */
	beatmapIsBanned(multiplayerLobby: MultiplayerLobby, beatmapId: number) {
		return multiplayerLobby.teamOneBans.indexOf(beatmapId) > -1 || multiplayerLobby.teamTwoBans.indexOf(beatmapId) > -1;
	}

	/**
	 * Check if the beatmap is banned by team one
	 * @param multiplayerLobby the multiplayerlobby to check from
	 * @param beatmapId the beatmap to check
	 */
	beatmapIsBannedByTeamOne(multiplayerLobby: MultiplayerLobby, beatmapId: number) {
		return multiplayerLobby.teamOneBans.indexOf(beatmapId) > -1;
	}

	/**
	 * Check if the beatmap is banned by team two
	 * @param multiplayerLobby the multiplayerlobby to check from
	 * @param beatmapId the beatmap to check
	 */
	beatmapIsBannedByTeamTwo(multiplayerLobby: MultiplayerLobby, beatmapId: number) {
		return multiplayerLobby.teamTwoBans.indexOf(beatmapId) > -1;
	}

	/**
	 * Check if a beatmap has been picked in the current lobby
	 * @param multiplayerLobby the multiplayerlobby to check from
	 * @param beatmapId the beatmap to check
	 */
	beatmapIsPicked(multiplayerLobby: MultiplayerLobby, beatmapId: number) {
		return multiplayerLobby.teamOnePicks != null && multiplayerLobby.teamTwoPicks != null &&
			(multiplayerLobby.teamOnePicks.indexOf(beatmapId) > -1 || multiplayerLobby.teamTwoPicks.indexOf(beatmapId) > -1);
	}

	/**
	 * Check if a beatmap has been picked by team one in the current lobby
	 * @param multiplayerLobby the multiplayerlobby to check from
	 * @param beatmapId the beatmap to check
	 */
	beatmapIsPickedByTeamOne(multiplayerLobby: MultiplayerLobby, beatmapId: number) {
		return multiplayerLobby.teamOnePicks != null && multiplayerLobby.teamOnePicks.indexOf(beatmapId) > -1;
	}

	/**
	 * Check if a beatmap has been picked by team two in the current lobby
	 * @param multiplayerLobby the multiplayerlobby to check from
	 * @param beatmapId the beatmap to check
	 */
	beatmapIsPickedByTeamTwo(multiplayerLobby: MultiplayerLobby, beatmapId: number) {
		return multiplayerLobby.teamTwoPicks != null && multiplayerLobby.teamTwoPicks.indexOf(beatmapId) > -1;
	}

	/**
	 * Unban a beatmap
	 * @param beatmap
	 * @param bracket
	 */
	unbanBeatmap(beatmap: ModBracketMap) {
		if (this.selectedLobby.teamOneBans.indexOf(beatmap.beatmapId) > -1) {
			this.selectedLobby.teamOneBans.splice(this.selectedLobby.teamOneBans.indexOf(beatmap.beatmapId), 1);
		}
		else if (this.selectedLobby.teamTwoBans.indexOf(beatmap.beatmapId) > -1) {
			this.selectedLobby.teamTwoBans.splice(this.selectedLobby.teamTwoBans.indexOf(beatmap.beatmapId), 1);
		}

		this.multiplayerLobbies.update(this.selectedLobby);
	}

	/**
	 * Pick a mystery map
	 * @param mappool the mappool to pick from
	 * @param modBracket the modbracket to pick from
	 */
	pickMysteryMap(mappool: Mappool, modBracket: ModBracket) {
		this.mappoolService.pickMysteryMap(mappool, modBracket, this.selectedLobby, this.ircService.authenticatedUser).subscribe((res: any) => {
			if (res.modCategory == null) {
				this.toastService.addToast(res.beatmapName, ToastType.Error, 60);
			}
			else {
				const modBracketMap = ModBracketMap.serializeJson(res);
				this.pickBeatmap(modBracketMap, modBracket, mappool.gamemodeId);

				// Pick a random map and update it to the cache
				this.selectedLobby.pickModCategoryForModBracket(modBracket, modBracketMap.modCategory);
				this.multiplayerLobbies.update(this.selectedLobby);
			}
		});
	}

	/**
	 * Toggle the player management tab
	 */
	togglePlayerManagement() {
		this.isPlayerManagementMinimized = !this.isPlayerManagementMinimized

		if (!this.isPlayerManagementMinimized) {
			this.scrollToTop();
		}
	}

	/**
	 * Change the host to a different player
	 * @param player
	 */
	setHost(player: MultiplayerLobbyPlayersPlayer) {
		this.ircService.sendMessage(this.selectedChannel.channelName, `!mp host ${player.username}`);
	}

	/**
	 * Kick the player from the match
	 * @param player
	 */
	kickPlayer(player: MultiplayerLobbyPlayersPlayer) {
		this.ircService.sendMessage(this.selectedChannel.channelName, `!mp kick ${player.username}`);
	}

	/**
	 * Move the player to a different slot
	 * @param player
	 */
	movePlayer(player: MultiplayerLobbyPlayersPlayer) {
		const dialogRef = this.dialog.open(MultiplayerLobbyMovePlayerComponent, {
			data: {
				movePlayer: player,
				allPlayers: this.selectedLobby.multiplayerLobbyPlayers
			}
		});

		dialogRef.afterClosed().subscribe((result: MultiplayerLobbyMovePlayerDialogData) => {
			if (result != undefined) {
				this.ircService.sendMessage(this.selectedChannel.channelName, `!mp move ${result.movePlayer.username} ${result.moveToSlot}`);
			}
		});
	}

	/**
	 * Change the colour of the current player
	 * @param player
	 */
	changeTeam(player: MultiplayerLobbyPlayersPlayer) {
		const newTeamColour = player.team == 'Red' ? 'blue' : 'red';
		this.ircService.sendMessage(this.selectedChannel.channelName, `!mp team ${player.username} ${newTeamColour}`);
	}

	/**
	 * Scroll irc chat to top
	 */
	scrollToTop() {
		this.virtualScroller.scrollToIndex(this.chats.length - 1, true, 0, 0);
	}

	/**
	 * Open a dialog to easily send result to the multiplayer lobby
	 */
	sendMatchResult() {
		const selectedMultiplayerLobby = this.multiplayerLobbies.getByIrcLobby(this.selectedChannel.channelName);

		this.dialog.open(SendBeatmapResultComponent, {
			data: {
				multiplayerLobby: selectedMultiplayerLobby,
				ircChannel: this.selectedChannel.channelName
			}
		});
	}
}
