import { Component, OnInit } from '@angular/core';
import { ModBracket } from '../../../models/osu-mappool/mod-bracket';
import { Mappool } from '../../../models/osu-mappool/mappool';
import { MappoolService } from '../../../services/mappool.service';
import { ModBracketMap } from '../../../models/osu-mappool/mod-bracket-map';
import { GetBeatmap } from '../../../services/osu-api/get-beatmap.service';
import { ElectronService } from '../../../services/electron.service';

@Component({
	selector: 'app-mappool-create',
	templateUrl: './mappool-create.component.html',
	styleUrls: ['./mappool-create.component.scss']
})

export class MappoolCreateComponent implements OnInit {
	creationMappool: Mappool;

	constructor(public electronService: ElectronService, private mappoolService: MappoolService, private getBeatmap: GetBeatmap) { 
		this.creationMappool = mappoolService.creationMappool;
	}

	ngOnInit() { }

	/**
	 * Create a new bracket
	 */
	createNewBracket() {
		this.creationMappool.addBracket(new ModBracket());
	}

	/**
	 * Add a new beatmap to the given bracket
	 * @param bracket the bracket to add the beatmap to
	 */
	addBeatmap(bracket: ModBracket) {
		bracket.addBeatmap(new ModBracketMap());
	}

	/**
	 * Remove the given beatmap from the given bracket
	 * @param bracket the bracket to remove the beatmap from
	 * @param beatmap the beatmap to remove
	 */
	removeBeatmap(bracket: ModBracket, beatmap: ModBracketMap) {
		bracket.removeMap(beatmap);
	}

	/**
	 * Get the data from the given beatmap
	 * @param beatmap the beatmap to synchronize
	 */
	synchronizeBeatmap(beatmap: ModBracketMap) {
		this.getBeatmap.getByBeatmapId(beatmap.beatmapId).subscribe(data => {
			beatmap.beatmapName = data.getBeatmapname();
			beatmap.beatmapUrl = data.getBeatmapUrl();
		});
	}

	/**
	 * Create the mappool from the creationMappool object
	 */
	createMappool() {
		// create the mappool here
	}
}
