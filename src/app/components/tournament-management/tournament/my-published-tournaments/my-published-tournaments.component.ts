import { Component, OnInit } from '@angular/core';
import { Tournament } from '../../../../models/tournament/tournament';
import { TournamentService } from '../../../../services/tournament.service';
import { AuthenticateService } from '../../../../services/authenticate.service';

@Component({
	selector: 'app-my-published-tournaments',
	templateUrl: './my-published-tournaments.component.html',
	styleUrls: ['./my-published-tournaments.component.scss']
})

export class MyPublishedTournamentsComponent implements OnInit {
	publishedTournaments: Tournament[] = [];

	constructor(private tournamentService: TournamentService, private authService: AuthenticateService) {
		this.authService.hasLoggedInUserLoaded().subscribe((hasLoaded: boolean) => {
			if (hasLoaded == true) {
				this.populateTournaments();
			}
		});

	}
	ngOnInit(): void { }

	/**
	 * Gets called when a tournament has been deleted
	 * @param deleted
	 */
	public tournamentHasBeenDeleted(deleted: boolean): void {
		if (deleted == true) {
			this.populateTournaments();
		}
	}

	/**
	 * Populate the tournaments array with your published tournaments
	 */
	populateTournaments() {
		this.publishedTournaments = [];

		this.tournamentService.getAllPublishedTournamentsFromUser(this.authService.loggedInUser).subscribe(data => {
			for (const tournament in data) {
				const newTournament: Tournament = Tournament.serializeJson(data[tournament]);
				this.publishedTournaments.push(newTournament);
			}
		});
	}
}
