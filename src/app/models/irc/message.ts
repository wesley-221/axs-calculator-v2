import { MessageBuilder } from "./message-builder";

export class Message {
    date: string;
    time: string;
    author: string;
    message: MessageBuilder[];
    comesFromHistory: boolean;
    isADivider: boolean;

    constructor(date: string, time: string, author: string, message: MessageBuilder[], comesFromHistory: boolean = false, isADivider: boolean = false) {
        this.date = date;
        this.time = time;
        this.author = author;
        this.message = message;
        this.comesFromHistory = comesFromHistory;
        this.isADivider = isADivider;
    }

    convertToJson(): { date: string, time: string, author: string, message: any[] } {
        return {
            date: this.date,
            time: this.time,
            author: this.author, 
            message: this.message.map(m => m.convertToJson())
        };
    }
}
