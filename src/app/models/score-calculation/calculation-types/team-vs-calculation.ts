import { ScoreInterface } from './score-interface';
import { MultiplayerDataUser } from '../../store-multiplayer/multiplayer-data-user';

export class TeamVsCalculation extends ScoreInterface {
	constructor(identifier: string) {
		super(identifier);

		this.setDescription('The regular team versus team score calculation.');
	}

	calculatePlayerScore(player: MultiplayerDataUser): number {
		return Number(player != null ? player.passed == 1 ? player.score : 0 : 0);
	}

	calculateTeamOneScore() {
		let teamScore = 0;

		for (let i = 0; i < this.getTeamSize(); i++) {
			teamScore += this.calculatePlayerScore(this.getUserBySlot(i));
		}

		return teamScore;
	}

	calculateTeamTwoScore() {
		let teamScore = 0;

		for (let i = this.getTeamSize(); i < this.getTeamSize() * 2; i++) {
			teamScore += this.calculatePlayerScore(this.getUserBySlot(i));
		}

		return teamScore;
	}
}
