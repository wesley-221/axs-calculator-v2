import { Mods } from "./osu-api";
import { MultiplayerDataUser } from "./multiplayer-data-user";

export class MultiplayerData {
    game_id: number;
    beatmap_id: number;
    mods: Mods;
    team_one_score: number;
    team_two_score: number;

    private players: MultiplayerDataUser[];

    constructor() {
        this.players = [];
    }

    /**
     * Add a player to the MultiplayerData
     * @param player the player to add
     */
    addPlayer(player: MultiplayerDataUser) {
        this.players.push(player);
    }

    /**
     * Get a specific player from the given slot
     * @param slot the slot of the player
     */
    getPlayer(slot: number) {
        if(this.players[slot] == undefined) {
            const tempUser = new MultiplayerDataUser();
            
            tempUser.slot = slot;
            tempUser.score = 0;
            tempUser.passed = 0;
            tempUser.mods = 0;
            tempUser.accuracy = 0;

            return tempUser;
        }

        return this.players[slot];
    }

    /**
     * Return all the players
     */
    getPlayers(): MultiplayerDataUser[] {
        return this.players;
    }

    /**
     * Get the player count
     */
    getPlayerCount() {
        return this.players.length;
    }
}
