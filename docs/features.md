# OpenFolk features

What OpenFolk does, feature by feature, written for the people who use it. Every section stands on its own, so it
can be read, quoted or posted alone. The German version is [features.de.md](features.de.md), with the same sections
under the same numbers. How to install and run OpenFolk is in the [README](../README.md).

## 1. Bots

Running one AI coding agent in a terminal is easy. Running five of them across several projects, and knowing which one
is waiting for you, is not. OpenFolk turns every agent into a bot: a colleague with a picture, a name, a role and a
tone, who works in one fixed folder, for example one bot per repository.

The bots sit in a list like the chats of a messenger. You see at a glance who is working, on what, and who has an
answer you have not read yet. Those two groups move to the top of the list, so the bots that need you are always the
first thing you see.

A bot keeps working when you close the app. When it is done or needs a decision, you get a notification on your phone.

## 2. Creating a bot

A new bot takes a minute. "+" opens a short page that asks for a role, a name and a folder or the address of a git
repository, nothing more. Ready-made templates stand under the role: Chief of Staff, Developer, Infrastructure, Social
Media, Landing Pages, Product Scout and Mail. A tap takes the role along with fitting working instructions and an
approval level.

OpenFolk suggests first names that go with the role, and you can ask for more. If you enter a repository address
instead of a folder, the machine clones it for the bot. A bot without a project of its own, for research or
brainstorming, leaves both fields empty and gets a folder named after it.

After "Create" the bot's chat opens and the bot does the rest itself: it looks at its folder, asks you a few questions
with options to tap, writes its own field of work and working instructions and offers a profile picture at the end.

## 3. Bot profile

Every bot has a page of its own with everything that makes it this bot: picture, field of work, role, tone, model,
approval level, the folder it sits in on the list, the bots it may give jobs to, and the voice that reads its answers
aloud.

For the picture there is a set of ready-made portraits. With an OpenAI or Gemini key in the settings, "AI avatar"
generates a photo instead, and "Suggest" proposes a name, a role or a picture from what the bot's folder says about
the project. A bot can also set or make its own picture when you ask it to in the chat.

"Duplicate bot" makes a copy under a new name with the same profile, model, folder and picture. Its routines come
along paused; history, knowledge and conversations stay with the original.

## 4. Approvals in the chat

An agent that may do anything is a risk, and an agent that asks about everything is useless. OpenFolk lets you choose
per bot. In the default level the bot asks before the things that can hurt: deleting, pushing, deploying, SSH,
restarting services, writing outside its folder, installing packages, running code from the internet, and every call
to an external service.

The request appears as a card in the chat, on your phone too. You allow it once, allow it for the rest of the session,
or deny it with a reason the bot reads and works with. A request nobody answers is denied after 30 minutes, and the
card stays in the chat, marked as expired. If you write a new message instead of answering, the open cards close,
nothing that was asked happens, and your message is the bot's next instruction.

Two more levels cover the edges: one asks before every single change, the other never asks. Whatever the level, a bot
never gets to read your secret files or keys.

## 5. Questions

Sometimes a bot does not need permission but a decision: which of three approaches, which name, which of the open
points first. It asks with a card in the chat that shows the options as buttons.

One tap answers. If none of the options fit, the card has a free text field. The question arrives as a notification
like an approval, so a bot never sits idle for hours because of a decision that takes you five seconds.

## 6. Notifications

Your phone tells you when a bot is done, when a routine has run, when a bot needs an approval or has a question, when
a machine has woken up, when a usage limit is reached, and when a person writes to you. Every kind can be set to off,
quiet, normal or high, for all your devices at once. Single bots and groups can be muted.

While you are working at a computer, the phone stays quiet: answers and routine results do not buzz in your pocket
when you are looking at them anyway. Approvals and questions only come through after three minutes, if nobody has
opened the chat or answered by then. One switch on the phone turns this off if you want every notification there.

You decide how much a notification of the mobile apps shows: the name of the bot, or nothing but "OpenFolk".

## 7. Messages while a bot works

You do not have to wait until a bot has finished to tell it something. A message you send while it works, typed or
spoken, goes into the running job: the bot reads it at its next step and takes it into its plan, the way it works in
the terminal. The chat tells you that this happened.

If the message is meant for later, "Afterwards" next to the input field queues it behind the running job. This works
for bots on Claude; the other AI providers queue every message until the job is done.

## 8. Activity

A bot's chat shows what the bot is doing, not just what it says. Every step, a file it reads, a command it runs, a
search, appears as a row you can open to see the result and how long it took. The list shows in one line what each
bot is working on right now.

Long tasks a bot starts in the background, a test run, a build, a helper agent, show in the status line above the
input field. While only those are running, "Stop" ends them on the bot's machine after asking you. What they did so
far stays.

## 9. Conversations and drafts

One bot, several topics. Besides its main chat a bot can have further conversations, each a fresh session in the same
folder: one for the refactoring, one for the bug of the day, one for brainstorming. They appear as tabs right below
the bot's name. A tap switches, "+" starts a new one, and a dot marks a tab that is working or has something unread.

Text you typed and did not send stays with its chat. Look into another chat and come back, and the text is there
again, also after a reload. The list shows "Draft: …" for such a chat, so you do not forget the half-written
message.

## 10. Group chats

Several bots in one chat. You address one bot with @ and its name, or everyone with @all, and each answers from its
own folder with its own knowledge: the developer about the code, the infrastructure bot about the server.

Bots can hand over to each other in the group with @, up to four times per message. A question about a failing deploy
goes from the developer to the infrastructure bot and back without you passing messages between two chats.

## 11. Folders

With ten or twenty bots the list needs order. "+" → "New folder" adds a folder to the list; bots and groups go in
from their menu or by dragging them onto the folder's heading. A tap on the heading folds the folder, and folders can
be renamed, moved and deleted.

Bots that are working or have an unread answer move to the top of the list, whatever folder they are in. For a folder
where that is not wanted, "Keep its bots in the folder" leaves them where they are.

You can also just ask a bot to tidy up: it sorts bots and groups into folders, creates new ones and says in its chat
what it moved. Folders are the same on all your devices.

## 12. Bot to bot

A bot can give another bot a job, on the same machine or on another one. The product bot asks the developer to build
something, the developer asks the infrastructure bot to check the server. A bot can also give a job to one of its own
conversations, say from brainstorming to coding.

The asking bot does not block. The result comes back into the conversation that gave the job by itself, however long
it takes; the bot carries on with it there, and you get a notification. A bar above the input field shows whom the
chat is waiting for and since when, with "Stop waiting" and "Cancel job".

Open jobs survive a restart. A job for a sleeping machine goes out when it wakes. Loops are refused, and in every
bot's settings you decide whom it may give jobs to: everyone, selected bots or nobody.

## 13. Missions

A mission gives a team of bots a long-term goal that it pursues on its own. You describe the goal in your own words,
and the builder turns it into a proposal: success and abort criteria, a team with one supervisor, milestones, risks,
a budget, guardrails and a schedule. You edit all of it before anything is created.

The supervisor then runs the mission in cycles. It plans tasks, hands them to the team, checks the results and
writes down its decisions with the reason. Four autonomy levels decide what it has to ask you first, from every
delegation down to only changes of limits. Budget, autonomy, rules and guardrails can only be changed by you in the
app, never by a bot.

The mission page shows the goal, the progress, the team at work, the tasks, the decisions waiting for you, the log
and the figures of the project as tiles, charts and tables. A kill switch stops everything until you resume.

## 14. Routines

A routine is a prompt on a schedule: daily, on weekdays, weekly, hourly or at any interval. "Check the open pull
requests every morning at 8", "write the weekly report on Friday".

On the bot's page every routine has a row that says in words when it runs, when the next run is, and a switch to
pause it. Opened, it shows its instruction, "Run now" and the last 20 runs with start, duration, status and, for a
failed run, the reason. "Show in chat" jumps to the answer.

You can also ask the bot in the chat: it creates and changes its own routines, never another bot's. A routine can wake
its machine for the run and shut it down afterwards.

## 15. Slash commands

If you use Claude Code in the terminal, you have commands and skills you rely on. They are there in OpenFolk too: "/"
at the start of a message lists the commands for the bot's folder, your own, the project's, those of plugins and a
few built-in ones.

They run exactly as in the terminal, also in group chats and inside routines. So a routine can start a command you
already wrote instead of repeating a long prompt.

This is for bots on Claude; the other AI providers have no such list.

## 16. Files, pictures and videos

Attach, paste or drop files into a chat. Images and PDFs go straight to the model, so a screenshot of the error is
often the fastest bug report. Bots send files back: the finished export, the generated image, the plan.

Pictures show in the chat and open large with a tap, videos play in the app, and Markdown files such as a plan a bot
wrote open formatted to read, with "Save" for the file.

Files travel end-to-end encrypted, up to 20 MB each. Secret files and keys are never handed out, whoever asks.

## 17. Knowledge

Bots remember. A bot keeps single facts, such as how you want commits written or which server is the staging system,
and has them at hand in every later conversation. A fact belongs to one bot, to a folder, to a group or to everyone.

Bots can also search the earlier messages of all chats on their machine. "What did we decide about the deploy?" gets
answered from the conversation in which it was decided, even if that was another bot's chat weeks ago.

Knowledge from outside, a wiki, Notion or Confluence, comes in through the services you connect to your bots.

## 18. Likes

"Like" in the menu of a bot's answer puts a heart on it. The bot does not answer the like. It hears of it with your
next message, and it may remember what you valued as part of how it works with you.

It is the quiet way of giving feedback: no "well done, more like this" message, just a tap, and the bot learns over
time what a good answer looks like for you. In chats with people a heart works as in any messenger: both of you see
it.

## 19. Voice messages and dictation

Hold the microphone and say what you want; the bot gets it as text. The recording is transcribed on the machine that
runs the bot, not by a cloud service. The machine's settings set this up with one button.

If you would rather see the text before it goes out, switch the microphone to dictation for that device: the text
field stays usable while you speak, the checkmark writes the text where the cursor was, and you send it as a normal
message. For better hits on project terms, the transcription gets the bot's name, folder and repository as hints.

## 20. Reading answers aloud

Every answer can be read aloud, from the message's menu or by itself when you asked with a voice message. That makes
a bot usable while cooking, driving or walking.

You choose where the voice comes from. The bot's machine reads free and offline, with a male and a female voice per
language. With an OpenAI or Gemini key the voices sound more natural; the text then goes to that provider. Every bot
can have its own voice, with "Listen" for a sample.

## 21. Voice conversation

The button next to the microphone opens a page where you talk with a bot hands-free. You speak, and after a pause the
recording goes out by itself. You see what was understood and what the bot is doing, and the answer is read aloud
sentence by sentence while the bot is still writing it. Then the microphone opens again.

So that this feels like a conversation, the dialog runs on a fast model and the bot is asked to answer briefly, in
spoken language. Heavy work, code, longer research, "think it through", goes to the bot's main chat on its own model,
and what was said arrives there too.

With an OpenAI key the conversation can run like the voice mode of ChatGPT instead: it notices the end of your
sentence and lets you interrupt. Your voice then goes to OpenAI and costs a few cents a minute.

## 22. Forwarding

"Forward" in a message's menu hands it to another bot, a conversation, a group or a person. The chosen chat opens
with the message above the input field; you add a few words, or none, and send it.

The bot gets the whole message and where it came from. An answer of the research bot becomes the job of the
developer without copy and paste. In the chat the forward shows a few lines, a tap opens the whole text, and the line
below it leads back to the chat it came from.

## 23. Favorites, pinned messages and read state

Mark the bots you use most as favorites, and pin the messages you keep coming back to, such as the decision, the
command or the link. A pinned message is one tap away at the top of its chat.

All of it, and what you have read, is the same on every device. Read an answer on the phone and it is read on the
desktop; pin a message at your desk and it is pinned on the phone.

## 24. Columns on wide screens

On a wide screen one chat is a waste of space. Ctrl-click or a middle click opens a chat in a column of its own next
to the others, as many as fit. You can also drag a chat from the list onto a column.

Every column has its own input field, queue and search. So you watch three bots work side by side and answer each
where it stands. The bot's page docks as a column too. Phones and laptops keep one chat.

## 25. Command palette and shortcuts

Ctrl+K (Cmd+K on a Mac) opens a palette over everything: bots, groups, people, conversations, routines, the sections
of the settings, and actions such as "new bot" or waking a machine that is off. It also finds messages and attached
files, and a hit opens the chat at that message.

For everything you do often there is a key: new bot, search in the chat, jump to the n-th chat, back and forward
through the chats you opened, send from anywhere. Ctrl+/ shows them all.

On the phone the search above the list does the same with filters for messages, bots, files and routines.

## 26. Open changes

The "Repos" tab shows what your bots left behind in git: uncommitted files and commits that are not pushed or not
pulled yet, for every repository in a bot's folder. A badge counts them.

Per repository you commit and push, or pull, with one tap, from the phone too. So the last step of a job no longer
waits until you are back at your desk.

## 27. Repos stay current

Nothing is more annoying than a bot that builds on yesterday's code. OpenFolk fetches the repositories of its bots
when it starts, after a machine wakes, every quarter of an hour, and when another of your machines pushes from the
app. Repositories without local changes move forward to the newest state.

It is careful about it: it never merges, rebases or resets, and it leaves a repository alone while a bot is working
in it. What it could not take over shows under "Open changes" with the reason. A switch in the settings turns it off.

## 28. VS Code and terminal

OpenFolk does not replace your editor. At your desk you keep working in VS Code, Cursor or the terminal, and
OpenFolk lists the sessions you ran there. You can follow them live and continue one as a conversation with a bot,
with its full context. You start something at the desk and carry on from the sofa.

The other way round works too: "Open this chat in the IDE" or "in a terminal" hands a chat's session to its machine,
and you continue there with the keyboard.

## 29. Several machines

The PC in the office, the laptop, a server. OpenFolk runs on each of them, and you see all their bots in one list.
Every bot lives on one machine and works in a folder there.

While a machine sleeps, its bots sleep, and the app offers to wake it. The "Status" tab shows every machine with its
bots and what is running there. Adding a machine is a link or a QR code from the settings.

## 30. Moving a bot

A bot moves to another machine with one tap on its page. The repository is cloned there if it is missing, a sleeping
machine is woken for the move, and the conversations come along with their full context. The bot carries on where it
stopped.

Work that is not on the git server yet comes along by itself: uncommitted changes, new files, commits that were never
pushed. It travels encrypted, without a push in between. So you can send a bot from the office PC to the laptop
before you leave, mid-task.

## 31. Waking and shutting down machines

A machine does not have to run all day for its bots to be reachable. OpenFolk wakes a sleeping or switched-off
machine when you need it, from the app or for a routine, and can shut it down again afterwards. A machine woken this
way runs its bots without anyone signing in on Windows and Linux.

That way the nightly routine runs on the strong PC at home, which is off the rest of the time. Waking needs a relay
on a server, because something has to be awake to do the waking.

## 32. Status and usage

The "Status" tab is the overview of your setup: the machines with their bots, which AI providers are ready on each,
and buttons to wake or shut down a machine.

It also shows how much of your subscription is used, the five-hour and the weekly window, and when each resets. So
you know before a long job whether there is room for it. A notification tells you when a limit is reached.

## 33. AI providers

Bots run on Claude Code by default. A bot, or a single conversation, can also use OpenAI Codex, Cursor, GitHub
Copilot, Google Antigravity or OpenCode. You choose the model per bot, so the infrastructure bot can run on something
other than the developer.

Every provider signs in with your own subscription or your own key, on your own machine. OpenFolk never sees those
logins and does not sell tokens. To try it without any account, OpenCode's free models need no sign-in.

## 34. Subscription and API key

Claude can run on your subscription, on an API key, or on both by rules. With both, the bots use the subscription
until it reports its limit and then carry on with the API key until the limit resets, up to a daily amount you set.

The job that hit the limit runs again on the key, so a long task does not die at three in the morning because the
weekly window is full.

## 35. Chats with people

OpenFolk is a messenger for people too. "+" → "Person" opens a chat with a team member or a customer on the same
relay. Text, files and voice messages go both ways, with notifications, search and everything a chat has.

A bot can hand over to a person: it sends them its summary, they get a notification, and you continue the topic with
them directly. Bots do not read the chats between people. "Block" stops messages in both directions.

## 36. Accounts

One installation can serve several people: you at work and at home, a colleague, one account per customer. Every
account has its own bots, chats, knowledge and devices and its own sign-ins to the AI providers, so subscriptions and
usage stay apart.

You invite someone with a link or a QR code. Per account you decide which machines it may use, for example only the
cloud server for a colleague, and whether it may write to everyone or only to the admins. A customer then reaches
their team and no other customer.

A device can be signed in to several accounts at once and shows their bots in one list.

## 37. A person on their own computer

An employee or customer can run their bots on their own computer, with their own subscription, while you set those
bots up from your OpenFolk. You prepare the account, choose the bots, for example a support bot that only reads the
project and a development bot that changes it, and send one link.

They install the desktop app, open the link and find their bots ready, with the repositories cloned. Your bots, chats
and machines never reach their computer, and their chats do not reach yours. You can change their bots later; the
change arrives the next time their computer is online.

## 38. Several relays

One relay per customer, one for the company, one private. The desktop and mobile apps can be signed in to several
relays at the same time. Each relay keeps its own machines, accounts and key.

The list shows the bots of all of them together, with the relay's name as a badge. So you do not have to switch
between installations to see who is waiting for you.

## 39. The vault

Bots need credentials for their work: the API token of the hosting provider, the password of a mail account. Those
do not belong in a chat. They go into the vault in the settings, with a name, a note and the bots that may use them.

A bot uses an entry by its name without ever seeing the value. The value is never shown in the app again, only
replaced or deleted, and it is blacked out of everything a bot says and does, so it cannot end up in an answer or in
the history. On disk the vault is encrypted.

## 40. End-to-end encryption

Everything between your devices and your machines is end-to-end encrypted, from the first start: chats, files,
history, the sync between machines. The relay in the middle only passes on what it cannot read, and it stores no
messages.

The logins of your AI providers never leave your machines. Whoever hosts the relay, including you on a rented
server, cannot read a chat and cannot use your subscriptions.

## 41. Devices and sign-in

A new device joins with a pairing link or a QR code created by a device that is already signed in. The link works
once, for 15 minutes, and hands over the key as well. It also works the other way round: a signed-in phone scans the
QR code on the sign-in page of a new laptop.

Every device has its own key and can be signed out individually. Every new sign-in triggers a notification, and a
second factor (TOTP) can be switched on.

## 42. Connectors

The services connected to your Claude account, such as Gmail or Drive, are powerful, and not every bot should reach
them. They stay out of the bots' sessions until you let them in, per machine, in its settings.

Tools you set up yourself for a project keep working as before. Each call to an external service asks for approval
first in the default level, and "always for this bot" remembers your answer.

## 43. Reporting

"Report" in the menu of a bot's answer or a person's message sends it with a reason to the admins of your relay.
When there is no other admin, the report goes to the publisher of the app.

This matters where several people share one installation: something that should not have been written gets to
someone who can act on it.

## 44. Apps for every device

The same app everywhere: in the browser, installable to the home screen; as a desktop app for Windows, macOS and
Linux; and as an app for iOS and Android. What you see on the phone is what you see at the desk.

The desktop app brings everything along. Install it, choose "Without setup" and it runs your bots on that computer,
without a terminal, and updates itself. The mobile apps add native notifications and keep the key in the phone's
secure storage.

The interface is available in English and German.

## 45. Three ways to run it

On one computer: install the desktop app and start. Nothing else is needed, and everything stays on that machine.

With a relay of your own on a small server: your phone reaches your bots from anywhere, notifications arrive, and
sleeping machines can be woken. Your machines connect outward, so nothing has to be opened on your router.

Entirely on a server: bots that run while all your computers are off. All three ways keep the same rule: the relay
passes on encrypted traffic, and sessions, history and logins stay on the machines that run the bots.

## 46. Open source

OpenFolk is open source under the MIT license. You may use, change and distribute it, also in your own products.
There is no account with us and no subscription to us, and your chats stay on your own machines.

The code is on GitHub at [OpenFolk/OpenFolk](https://github.com/OpenFolk/OpenFolk). Bugs, ideas and contributions are
welcome there.
