# Project: Expense Splitter

**AI tools:** Fully allowed and encouraged (Copilot, Cursor, ChatGPT, Claude, etc.) - use them the way you would on the job.

## Background

A group of friends share expenses on a trip - one person pays for dinner, another books the hotel, someone else covers gas. All amounts are in Sri Lankan Rupees (LKR). At the end, everyone wants to know: who owes whom, and how do we settle up with the fewest payments possible?

Build a small app that solves this.

## Core Requirements

No login or user accounts needed - this is a single-session tool, not a multi-user app.

Your app should let a user:

1. Add people to a group by name - no limit on group size (2 people or 10, doesn't matter, just needs to work for any number)
2. Log an expense, capturing:
   - Amount
   - Who paid
   - Who the expense is split between
   - How it's split - support at least these two:
     - Equal split among selected people
     - One of - Percentage split OR Exact amount split (pick whichever you'd rather build)
3. Edit or delete an expense after it's created, with balances recalculating correctly afterward
4. View running balances - how much each person is net owed or owes overall
5. View a "Settle Up" screen - the minimum number of transactions needed to bring everyone's balance to zero (not just a list of every pairwise debt)

The UI doesn't need to be polished. It needs to be usable and make the flow (add people → log expenses → view balances → settle up) clear.

## You Must Explicitly Handle

This is the actual point of the exercise - please don't skip it:

- **Rounding.** If Rs. 100 is split three ways, someone ends up with an extra cent (i.e., a fraction of a rupee) somewhere. Show how your app handles this so that balances always reconcile to zero, not to Rs. 99.99 or Rs. 100.01.

If you have time left over, also handle splits that don't add up (percentages ≠ 100%, exact amounts ≠ total) - this is a bonus, not required.

## Left to Your Judgment

Make a reasonable call on each of these and note your assumption in the README - there's no single right answer:

- **Persistence.** In-memory, localStorage, a local file, a database - pick whatever lets you spend the most time on the split/settle-up logic rather than infrastructure.
- **Currency.** Assume a single currency (LKR).
- **Tech stack.** Use whatever you're fastest and most comfortable in.

## What to Submit

1. A public GitHub repo link containing your working app
2. A README (in the repo) covering:
   - How to run it
   - The assumptions you made and why
   - Anything you'd do differently, or build next, with more time
   - Anything you left incomplete, and why you prioritized the way you did
3. A separate file with prompt history
4. If your project uses a `.env` file (API keys, config values, etc.), do not commit it to the repo. Instead, copy its contents into a plain `.txt` file (e.g., `env-values.txt`) and send it to us separately.

## A Note on Scope

It's fine - expected, even - to leave some things unfinished. Prioritize correctness of the split calculations and the settle-up logic over UI polish or covering every edge case. A correct, plain-looking app beats a beautiful one with wrong balances.

## Try This Before You Submit

Run this scenario through your app and sanity-check the output:

People: Alice, Bob, Carol, Dave

1. Alice paid Rs. 12,000, split equally among all 4
2. Carol paid Rs. 10,000, split by exact amount - Alice Rs. 3,333.33, Bob Rs. 3,333.33, Dave Rs. 3,333.34
3. Dave paid Rs. 6,000, split equally between Dave and Bob only

(If you chose Percentage instead of Exact Amount as your second split type, swap step 2 for something like: Carol paid Rs. 10,000, split by percentage - Alice 40%, Bob 30%, Dave 30%.)

Check that:

- Final balances sum to approximately Rs. 0 (within a cent)
- The Settle Up screen shows a minimized set of transactions, not every pairwise debt
- No one is double-counted or missing from a split they should be part of

Good luck - we're looking forward to seeing how you think through this.
