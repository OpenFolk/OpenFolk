/* OpenFolk web app: quick names for a new bot, alliterating with its role, without the model (editors.js). */
import { i18n } from './i18n.js';

/** Common first names per initial, women's and men's mixed; the language is the app's, English as fallback. */
const FIRST_NAMES = {
    de: {
        A: ['Anna', 'Anton', 'Alina', 'Andreas', 'Amelie', 'Arne', 'Antje', 'Albert'],
        B: ['Bernd', 'Britta', 'Benno', 'Beate', 'Bastian', 'Birgit', 'Bruno', 'Bettina'],
        C: ['Clara', 'Carsten', 'Carla', 'Christian', 'Cora', 'Clemens', 'Celine', 'Conrad'],
        D: ['Dana', 'Daniel', 'Doris', 'David', 'Dörte', 'Dirk', 'Diana', 'Dominik'],
        E: ['Emma', 'Erik', 'Elke', 'Elias', 'Ella', 'Emil', 'Eva', 'Edgar'],
        F: ['Frieda', 'Felix', 'Franziska', 'Florian', 'Frauke', 'Fabian', 'Fiona', 'Frank'],
        G: ['Greta', 'Gustav', 'Gisela', 'Georg', 'Gesa', 'Gerd', 'Gudrun', 'Gunnar'],
        H: ['Hanna', 'Henrik', 'Helga', 'Hannes', 'Hedda', 'Holger', 'Heike', 'Hugo'],
        I: ['Ida', 'Ingo', 'Ines', 'Immo', 'Ilse', 'Igor', 'Iris', 'Isabel'],
        J: ['Jana', 'Jonas', 'Julia', 'Jakob', 'Jutta', 'Jens', 'Josefine', 'Johann'],
        K: ['Klara', 'Konrad', 'Katja', 'Kai', 'Karin', 'Kilian', 'Kerstin', 'Kurt'],
        L: ['Lena', 'Lukas', 'Lotte', 'Leon', 'Lisa', 'Lars', 'Luise', 'Ludwig'],
        M: ['Mia', 'Max', 'Marie', 'Moritz', 'Martina', 'Matthias', 'Maja', 'Malte'],
        N: ['Nina', 'Niklas', 'Nele', 'Nils', 'Nora', 'Norbert', 'Nadja', 'Nico'],
        O: ['Olga', 'Oskar', 'Ottilie', 'Ole', 'Olivia', 'Otto', 'Odette', 'Oliver'],
        P: ['Paula', 'Paul', 'Petra', 'Philipp', 'Pia', 'Peter', 'Priska', 'Patrick'],
        Q: ['Quirin', 'Quentin', 'Quinn', 'Quintus'],
        R: ['Rudolf', 'Rita', 'Rainer', 'Rosa', 'Robert', 'Rebekka', 'Rolf', 'Ronja'],
        S: ['Sandra', 'Simon', 'Sophie', 'Stefan', 'Sina', 'Sebastian', 'Silke', 'Sven'],
        T: ['Tina', 'Tobias', 'Theresa', 'Tim', 'Tanja', 'Theo', 'Thea', 'Thomas'],
        U: ['Ulla', 'Ulrich', 'Ute', 'Udo', 'Ulrike', 'Uwe', 'Ursula', 'Urs'],
        V: ['Vera', 'Viktor', 'Verena', 'Vincent', 'Valerie', 'Volker', 'Viola', 'Veit'],
        W: ['Wiebke', 'Wolfgang', 'Wanda', 'Werner', 'Wilma', 'Wilhelm', 'Waltraud', 'Walter'],
        X: ['Xenia', 'Xaver', 'Ximena', 'Xander'],
        Y: ['Yvonne', 'Yannick', 'Yara', 'Yusuf'],
        Z: ['Zoe', 'Zacharias', 'Zita', 'Zeno'],
    },
    en: {
        A: ['Alice', 'Adam', 'Amy', 'Aaron', 'Anna', 'Alex', 'Ava', 'Arthur'],
        B: ['Beth', 'Ben', 'Bianca', 'Brian', 'Bella', 'Bruce', 'Bonnie', 'Blake'],
        C: ['Claire', 'Chris', 'Carol', 'Colin', 'Chloe', 'Carl', 'Cathy', 'Caleb'],
        D: ['Dana', 'Dan', 'Daisy', 'David', 'Donna', 'Derek', 'Diana', 'Dylan'],
        E: ['Emma', 'Ethan', 'Ellen', 'Eric', 'Eva', 'Edward', 'Erin', 'Elliot'],
        F: ['Fiona', 'Frank', 'Faith', 'Felix', 'Flora', 'Fred', 'Freya', 'Finn'],
        G: ['Grace', 'George', 'Gina', 'Gavin', 'Gwen', 'Graham', 'Gloria', 'Gordon'],
        H: ['Hannah', 'Henry', 'Holly', 'Harry', 'Helen', 'Hugo', 'Heidi', 'Howard'],
        I: ['Iris', 'Ian', 'Isla', 'Isaac', 'Ivy', 'Ivan', 'Irene', 'Idris'],
        J: ['Jane', 'Jack', 'Julia', 'James', 'Jess', 'Joel', 'Joan', 'Jasper'],
        K: ['Kate', 'Kevin', 'Kim', 'Kyle', 'Kelly', 'Keith', 'Kara', 'Ken'],
        L: ['Lily', 'Liam', 'Laura', 'Leo', 'Lucy', 'Luke', 'Lena', 'Lewis'],
        M: ['Mia', 'Max', 'Molly', 'Mark', 'Megan', 'Martin', 'Maya', 'Miles'],
        N: ['Nina', 'Nathan', 'Nora', 'Neil', 'Nancy', 'Noah', 'Nell', 'Nick'],
        O: ['Olivia', 'Oliver', 'Opal', 'Oscar', 'Orla', 'Owen', 'Odette', 'Otis'],
        P: ['Paula', 'Peter', 'Penny', 'Paul', 'Polly', 'Patrick', 'Phoebe', 'Philip'],
        Q: ['Quinn', 'Quentin', 'Queenie', 'Quincy'],
        R: ['Rosie', 'Ryan', 'Ruth', 'Rob', 'Rachel', 'Ross', 'Rita', 'Rupert'],
        S: ['Sophie', 'Sam', 'Sarah', 'Simon', 'Stella', 'Steve', 'Sue', 'Seth'],
        T: ['Tina', 'Tom', 'Tess', 'Toby', 'Tara', 'Theo', 'Thea', 'Trevor'],
        U: ['Una', 'Umar', 'Ursula', 'Ulysses'],
        V: ['Vera', 'Victor', 'Violet', 'Vince', 'Vicky', 'Vernon', 'Valerie', 'Vaughn'],
        W: ['Wendy', 'Will', 'Willa', 'Wes', 'Wanda', 'Walter', 'Winnie', 'Wade'],
        X: ['Xena', 'Xavier', 'Xiomara', 'Xander'],
        Y: ['Yara', 'Yusuf', 'Yvonne', 'Yannick'],
        Z: ['Zoe', 'Zach', 'Zara', 'Zane'],
    },
};

/** Words at the start of a role that lend no initial: articles, pronouns and prepositions of both languages. */
const SKIPPED = new Set([
    'der', 'die', 'das', 'ein', 'eine', 'einen', 'mein', 'meine', 'für', 'und', 'im', 'in', 'am', 'an', 'zu', 'mit', 'von', 'den', 'dem', 'des',
    'the', 'a', 'an', 'my', 'for', 'and', 'at', 'to', 'with', 'of', 'on',
]);

/** The initial the names share with the role: of its first word that is no article or preposition; '' without one. */
export function initialOf(role) {
    for (const word of role.trim().split(/\s+/)) {
        const w = word.replace(/^[^\p{L}]+/u, '');
        if (!w || SKIPPED.has(w.toLowerCase())) continue;
        // Ä, Ö, Ü lend A, O, U
        const c = w[0].toUpperCase().normalize('NFD').replace(/\p{M}/gu, '');
        return /^[A-Z]$/.test(c) ? c : '';
    }
    return '';
}

/**
 * `count` names with that initial in the app's language, in random order, other ones than `shown` as far as the
 * list allows; none for an initial without names.
 */
export function namesWith(initial, count = 3, shown = []) {
    const list = (FIRST_NAMES[i18n.language] || FIRST_NAMES.en)[initial] || [];
    let pool = list.filter((n) => !shown.includes(n));
    if (pool.length < count) pool = [...list];
    const out = [];
    while (pool.length && out.length < count) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    return out;
}
