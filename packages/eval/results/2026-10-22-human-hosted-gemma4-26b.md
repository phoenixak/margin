# Human-text eval: hosted-gemma4-26b (2026-10-22, commit a999dd0)

Model: `gemini:gemma-4-26b-a4b-it` (gemini), batch 8, concurrency 1. Harper runs first and Margin skips anything Harper flags, as in the extensions.

## JFLEG test set: 747 sentences from learner essays, 4 human corrections each

Edits are compared word by word with the closest human correction. "Recall without spelling" leaves out one-word spelling and capitalization fixes, which Margin leaves to Harper by design. "Clean sentences changed" counts sentences all four humans left alone.

| system | precision | recall | F0.5 | recall without spelling | sentences changed | clean sentences changed |
|---|---|---|---|---|---|---|
| Harper alone (first suggestion) | 52.2% | 23.7% | 0.421 | 10.3% | 386 | 2/32 |
| Margin alone (gemini:gemma-4-26b-a4b-it, skipping Harper's spans) | 75.1% | 14.7% | 0.411 | 15.9% | 192 | 0/32 |
| Harper + Margin (what you get) | 58.8% | 35.7% | 0.520 | 24.6% | 500 | 2/32 |

170 model calls, 802 s (1073 ms per sentence). Rejected by guards: 50.

## Published prose: 200 paragraphs (719 sentences, 16,611 words) from four public-domain books

Professionally edited text, so nearly every suggestion here is a false alarm (or old spelling and style). Books: The Great Gatsby (1925), The Age of Innocence (1920), Main Street (1920), The Economic Consequences of the Peace (1919).

| | Harper | Margin |
|---|---|---|
| flags | 402 | 33 |
| per 1,000 words | 24.2 | 2.0 |
| sentences Margin changed | | 30 of 719 (4.2%) |
| paragraphs Margin flagged | | 28 of 200 |

111 model calls, 364 s. Rejected by guards: 22.

### Every sentence Margin changed

- *The Great Gatsby (1925)*: “When she moved about there was an incessant clicking as innumerable pottery bracelets jingled up and down upon her arms.” → “When she moved about, there was an incessant clicking as innumerable pottery bracelets jingled up and down upon her arms.” (Added a comma after an introductory adverbial clause.)
- *The Great Gatsby (1925)*: “I was immediately struck by the number of young Englishmen dotted about; all well dressed, all looking a little hungry, and all talking in low, earnest voices to solid and prosperous Americans.” → “I was immediately struck by the number of young Englishmen dotted about; all well-dressed, all looking a little hungry, and all talking in low, earnest voices to solid and prosperous Americans.” (Added a hyphen to the compound adjective 'well-dressed'.)
- *The Great Gatsby (1925)*: “It was on that same house-party that we had a curious conversation about driving a car.” → “It was at that same house-party that we had a curious conversation about driving a car.” (Preposition 'at' is more appropriate for a house-party.)
- *The Great Gatsby (1925)*: “The day agreed upon was pouring rain.” → “The day agreed upon, it was pouring rain.” (The sentence structure is awkward and lacks a clear subject.)
- *The Great Gatsby (1925)*: “Wondering if he were sick I went over to find out—an unfamiliar butler with a villainous face squinted at me suspiciously from the door.” → “Wondering if he was sick, I went over to find out—an unfamiliar butler with a villainous face squinted at me suspiciously from the door.” (Added a comma after the introductory phrase and corrected verb tense.)
- *The Great Gatsby (1925)*: “As we passed over the dark bridge her wan face fell lazily against my coat’s shoulder and the formidable stroke of thirty died away with the reassuring pressure of her hand.” → “As we passed over the dark bridge, her wan face fell lazily against my coat’s shoulder, and the formidable stroke of thirty died away with the reassuring pressure of her hand.” (Added commas to separate introductory clause and independent clauses.)
- *The Great Gatsby (1925)*: “Just as I slowed up to avoid overtaking him he stopped and began frowning into the windows of a jewellery store.” → “Just as I slowed up to avoid overtaking him, he stopped and began frowning into the windows of a jewellery store.” (Added a comma after an introductory adverbial clause.)
- *The Age of Innocence (1920)*: “When he reached the stud-farm a glance showed him that the horse was not what he wanted; nevertheless he took a turn behind it in order to prove to himself that he was not in a hurry.” → “When he reached the stud-farm a glance showed him that the horse was not what he wanted; nevertheless, he took a turn behind it in order to prove to himself that he was not in a hurry.” (Added a comma after the conjunctive adverb 'neversheless'.)
- *The Age of Innocence (1920)*: “There was a familiar air about their overcoats and the way their smart silk mufflers were folded over their white ties; and he wondered how youths of their quality happened to be dining out so early.” → “There was a familiar air about their overcoats and the way their smart silk mufflers were folded over their white ties, and he wondered how youths of their quality happened to be dining out so early.” (Removed unnecessary semicolon before the coordinating conjunction.)
- *The Age of Innocence (1920)*: “The amber beads were trying to her complexion, or her dress was perhaps unbecoming: her face looked lustreless and almost ugly, and he had never loved it as he did at that minute.” → “The amber beads were trying her complexion, or her dress was perhaps unbecoming: her face looked lustreless and almost ugly, and he had never loved it as he did at that minute.” (Removed extra preposition 'of' after 'trying'.)
- *The Age of Innocence (1920)*: “If you are, let's make it up and go and lunch at Henri's.” → “If you are, let's make it up and go to lunch at Henri's.” (Added missing preposition 'to' before 'lunch'.)
- *Main Street (1920)*: “The story would be the same in Ohio or Montana, in Kansas or Kentucky or Illinois, and not very differently would it be told Up York State or in the Carolina hills.” → “The story would be the same in Ohio or Montana, in Kansas or Kentucky or Illinois, and not very differently would it be told in Up York State or in the Carolina hills.” (Missing preposition 'in' before 'Up York State'.)
- *Main Street (1920)*: “And the English was real poor.” → “And the English was really poor.” (Adverb needed to modify the adjective poor.)
- *Main Street (1920)*: ““But sometimes,” Raymie sighed, “there is a pair of dainty little shoes like these, and I set them aside for some one who will appreciate.” → ““But sometimes,” Raymie sighed, “there is a pair of dainty little shoes like these, and I set them aside for some one who will appreciate them.” (The verb appreciate requires a direct object.)
- *Main Street (1920)*: “At the end of the road she saw the open acres--dipping rolling fields bright with wheat.” → “At the end of the road she saw the open acres--dipping, rolling fields bright with wheat.” (Added a comma to separate coordinate adjectives.)
- *Main Street (1920)*: “I put the side-curtains up, it was so chilly.” → “I put the side-curtains up; it was so chilly.” (Fixed a comma splice.)
- *Main Street (1920)*: “Or old Bingham Playfair, that died here 'bout a year ago--lived seven miles out.” → “Or old Bingham Playfair, who died here 'bout a year ago--lived seven miles out.” (Use 'who' for people instead of 'that'.)
- *Main Street (1920)*: “He thought she was a hayseed, she worried.” → “He thought she was a hayseed; she worried.” (Fixes a comma splice.)
- *Main Street (1920)*: “Miss Vida Sherwin the ever popular teacher in our high school pleased as Mrs. Grimm, Dr. Gould was well suited in the role of young lover--girls you better look out, remember the doc is a bachelor.” → “Miss Vida Sherwin, the ever popular teacher in our high school, pleased as Mrs. Grimm; Dr. Gould was well suited in the role of young lover--girls you better look out, remember the doc is a bachelor.” (Added commas for appositive and semicolon to fix a run-on.)
- *Main Street (1920)*: “Why, Perce Bresnahan was saying there isn't a finer bunch of royal good fellows anywhere than just the crowd that were here tonight!”” → “Why, Perce Bresnahan was saying there isn't a finer bunch of royal good fellows anywhere than just the crowd that was here tonight!”” (The collective noun crowd takes a singular verb.)
- *Main Street (1920)*: “Carol had noticed her on the street, had heard almost as much about her as about Erik Valborg.” → “Carol had noticed her on the street, and had heard almost as much about her as about Erik Valborg.” (Added a conjunction to fix a comma splice. )
- *Main Street (1920)*: “The Jolly Seventeen looked disappointed, but the Jolly Seventeen liked to give advice, the Jolly Seventeen liked to mention the expensive hotels at which they had stayed.” → “The Jolly Seventeen looked disappointed, but the Jolly Seventeen liked to give advice; the Jolly Seventeen liked to mention the expensive hotels at which they had stayed.” (Fixed a comma splice by using a semicolon.)
- *Main Street (1920)*: “Before they could question her again Carol escorted in with drum and fife the topic of Raymie Wutherspoon.” → “Before they could question her again, Carol escorted in with drum and fife the topic of Raymie Wutherspoon.” (Added a comma after an introductory phrase.)
- *Main Street (1920)*: “He had been gassed in the trenches, had been in a hospital for two weeks, had been promoted to major, was learning French.” → “He had been gassed in the trenches, had been in a hospital for two weeks, had been promoted to major, and was learning French.” (Added a conjunction to complete the parallel list.)
- *The Economic Consequences of the Peace (1919)*: “Thus it was that Clemenceau brought to success, what had seemed to be, a few months before, the extraordinary and impossible proposal that the Germans should not be heard.” → “Thus it was that Clemenceau brought to success what had seemed to be, a few months before, the extraordinary and impossible proposal that the Germans should not be heard.” (Removed unnecessary commas around the object clause.)
- *The Economic Consequences of the Peace (1919)*: “[49] Numerous commercial agreements during the war ware arranged on these lines.” → “[49] Numerous commercial agreements during the war were arranged on these lines.” (Changed 'ware' to 'were'.)
- *The Economic Consequences of the Peace (1919)*: “Even if my figure prove erroneous, M. Klotz's can never have been justified.” → “Even if my figure proves erroneous, M. Klotz's can never have been justified.” (Subject–verb agreement.)
- *The Economic Consequences of the Peace (1919)*: “Under the scheme for dealing with enemy debts outlined in Chapter IV., the first charge on these assets is the private claims of Allied against German nationals.” → “Under the scheme for dealing with enemy debts outlined in Chapter IV., the first charge on these assets is the private claims of Allies against German nationals.” (Changed 'Allied' to 'Allies' to match the noun usage.)
- *The Economic Consequences of the Peace (1919)*: “It is an extraordinary fact that the fundamental economic problems of a Europe starving and disintegrating before their eyes, was the one question in which it was impossible to arouse the interest of the Four.” → “It is an extraordinary fact that the fundamental economic problems of a Europe starving and disintegrating before their eyes, were the one question in which it was impossible to arouse the interest of the Four.” (Subject 'problems' is plural, so the verb must be 'were'.)
- *The Economic Consequences of the Peace (1919)*: “With the Reparation problem thus cleared up it would be possible to bring forward with a better grace and more hope of success two other financial proposals, each of which involves an appeal to the generosity of the United States.” → “With the Reparation problem thus cleared up, it would be possible to bring forward with a better grace and more hope of success two other financial proposals, each of which involves an appeal to the generosity of the United States.” (Added a comma after the introductory phrase.)
