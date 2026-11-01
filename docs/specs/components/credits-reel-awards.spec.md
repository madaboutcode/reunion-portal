# WC2026 Prediction Contest — Awards Spec

Static, precomputed awards page. Data is baked in — no API calls.

## Awards

### 1. Nostradamus of Karicode

- **Subtitle:** "The one who saw it all coming"
- **Criteria:** Highest total points across the entire tournament
- **Winner:** Esha Test (Chemical Engineering) — 683 pts, 102 matches
- **Contenders:**
  - Asha Example (Mech Prod) — 668 pts, 94 matches
  - Farid Mock (EEE) — 652 pts, 99 matches
  - Kiran Sample (EEE) — 651 pts, 102 matches
  - Gita Dummy (Civil) — 647 pts, 102 matches

### 2. Chacko Master Award

- **Subtitle:** "Precision is not a request"
- **Criteria:** Most exact scoreline predictions
- **Winner:** Asha Example (Mech Prod) — 18 exact scores
- **Contenders:**
  - Gita Dummy (Civil) — 16 exact scores
  - Kiran Sample (EEE) — 15 exact scores
  - Ben Sample (ECE) — 14 exact scores
  - Farid Mock (EEE) — 14 exact scores

### 3. Velichappadu Award

- **Subtitle:** "Called it when nobody believed"
- **Criteria:** Most upset bonus points (R32 onward, <10% of predictors got the result right)
- **Winner:** manudemo (ECE) — 10 upset pts (1 upset, exact score)
- **Contenders:**
  - Ben Sample (ECE) — 5 upset pts
  - Hari Synthetic (EEE) — 5 upset pts

### 4. Thuruppu Gulan

- **Subtitle:** "Played the Joker, doubled the stakes"
- **Criteria:** Highest total points from Joker plays
- **Winner:** Farid Mock (EEE) — 91 joker pts from 7 jokers
- **Contenders:**
  - Gita Dummy (Civil) — 81 joker pts, 7 jokers
  - Esha Test (Chemical) — 80 joker pts, 7 jokers
  - Hari Synthetic (EEE) — 70 joker pts, 6 jokers
  - Asha Example (Mech Prod) — 61 joker pts, 6 jokers

### 5. Fazil Award

- **Subtitle:** "Spotted the star before anyone else"
- **Criteria:** Most correct Man of the Match predictions (+20 pts each, from QF onward)
- **Winners (4-way tie):**
  - Esha Test (Chemical) — 3 correct, 60 MoM pts
  - Ravi Dummy (Chemical) — 3 correct, 60 MoM pts
  - Farid Mock (EEE) — 3 correct, 60 MoM pts
  - Quin Fixture (EEE) — 3 correct, 60 MoM pts
- **Contenders:**
  - Ben Sample (ECE) — 2 correct, 40 MoM pts

### 6. Nokia 3310 Award

- **Subtitle:** "Unbreakable. Consistent. Never out of range."
- **Criteria:** Highest hit rate among serious players (predicted 5+ R32 matches AND 3+ of last 10 matches)
- **Winner:** Asha Example (Mech Prod) — 70.2% hit rate, 28 misses / 94 matches
- **Contenders:**
  - Chitra Demo (EEE) — 69.7% hit rate, 30 misses / 99 matches
  - Ravi Dummy (Chemical) — 67.1% hit rate, 26 misses / 79 matches
  - Kiran Sample (EEE) — 66.7% hit rate, 34 misses / 102 matches
  - Esha Test (Chemical) — 65.7% hit rate, 35 misses / 102 matches

### 7. Series Exam Star

- **Subtitle:** "Topped the internals. Peak group-stage form."
- **Criteria:** Highest total points during the group stage
- **Winner:** Asha Example (Mech Prod) — 326 pts in group stage
- **Contenders:**
  - Kiran Sample (EEE) — 308 pts
  - Esha Test (Chemical) — 307 pts
  - Chitra Demo (EEE) — 304 pts
  - Ben Sample (ECE) — 300 pts

### 8. Desert Storm Award

- **Subtitle:** "Shows up when the stakes are highest"
- **Criteria:** Highest total points in knockout rounds (R32 onward)
- **Winner:** Farid Mock (EEE) — 382 pts in knockouts
- **Contenders:**
  - Esha Test (Chemical) — 376 pts
  - Gita Dummy (Civil) — 374 pts
  - Ben Sample (ECE) — 343 pts
  - Kiran Sample (EEE) — 343 pts

### 9. Kanippayyur Jr.

- **Subtitle:** "The branch-level prophet"
- **Criteria:** Top scorer from each engineering branch (min 3 participants in branch)
- **Winners (one per branch):**
  - Esha Test (Chemical) — 683 pts
  - Asha Example (Mech Prod) — 668 pts
  - Farid Mock (EEE) — 652 pts
  - Gita Dummy (Civil) — 647 pts
  - Ben Sample (ECE) — 643 pts
  - Omar Mock (CSE) — 562 pts
  - Priya Placeholder (Mech) — 404 pts

### 10. Rolling Trophy

- **Subtitle:** "The department that brought it home"
- **Criteria:** Highest average points per player (min 3 participants from branch)
- **Winner:** ECE — 446 avg, 7 players, 3119 total pts
- **Contenders:**
  - Chemical Engineering — 432 avg, 4 players
  - EEE — 390 avg, 10 players
  - Mech Prod — 371 avg, 3 players
  - CSE — 264 avg, 5 players
  - Civil — 245 avg, 3 players
  - Mechanical — 123 avg, 8 players

---

## Image Generation Prompts

### Style brief (applies to all)

- Flat vector illustration, sticker/badge aesthetic
- Color palette: dark teal (#1F2A33), gold (#D4A853), white accents
- **Background: solid bright magenta (#FF00FF) chroma key** — no gradients, no shadows on the background, hard edge between sticker and background. This will be keyed out in post.
- Each sticker is a self-contained circular or shield-shaped badge
- No text whatsoever in the image — all labels are overlaid by the app
- Clean edges suitable for cutout

### Batch sheet prompt (all 10 on one image)

```
A sprite sheet of 10 football prediction contest award stickers arranged in a 5×2 grid on a solid bright magenta (#FF00FF) background. Each sticker is a circular badge with dark teal (#1F2A33) and gold (#D4A853) coloring, flat vector illustration style, clean hard edges against the magenta background. No text on any sticker.

Row 1, left to right:
1. Crystal ball with football pitch lines inside, stars and constellations around it
2. Bullseye target with a football as the center dot, precise geometric lines radiating out
3. Oracle figure silhouette with raised arms, glowing halo, football floating above, lightning accents
4. Playing card (trump/joker) with football emblem, golden coins spilling behind
5. Director's clapperboard with spotlight beam on a football boot

Row 2, left to right:
6. Nokia 3310 phone rendered as an indestructible shield, football bouncing off it
7. Stack of exam papers with a gold star on top, football nestled among them
8. Football blazing through a sandstorm with lightning, trail of fire behind it
9. Small astrology wheel/horoscope chart with football at center, oil lamp beside it
10. Large trophy cup with football on top, laurel wreath border, team silhouettes around base

Flat vector, badge/medallion style, solid magenta background, absolutely no text. Each badge cleanly separated with even spacing.
```

### Individual prompts (if generating one at a time)

**1. Nostradamus of Karicode**
```
A circular badge sticker: crystal ball floating above an ancient scroll, faint football pitch lines visible inside the crystal ball, stars and constellation patterns around it. Flat vector illustration, dark teal (#1F2A33) and gold (#D4A853) palette. Solid bright magenta (#FF00FF) background, hard edges. No text. Square format, 512×512px.
```

**2. Chacko Master Award**
```
A circular badge sticker: sharp pencil striking a bullseye target dead center, football replacing the bullseye dot, precise geometric lines radiating from impact. Flat vector illustration, dark teal (#1F2A33) and gold (#D4A853) palette. Solid bright magenta (#FF00FF) background, hard edges. No text. Square format, 512×512px.
```

**3. Velichappadu Award**
```
A circular badge sticker: dramatic oracle figure silhouetted with raised arms, glowing halo behind, football floating above, lightning bolt accents. Flat vector illustration, dark teal (#1F2A33) and gold (#D4A853) palette. Solid bright magenta (#FF00FF) background, hard edges. No text. Square format, 512×512px.
```

**4. Thuruppu Gulan**
```
A circular badge sticker: playing card (trump/joker card) fanned out with football emblem on the face, golden coins spilling from behind the card. Flat vector illustration, dark teal (#1F2A33) and gold (#D4A853) palette. Solid bright magenta (#FF00FF) background, hard edges. No text. Square format, 512×512px.
```

**5. Fazil Award**
```
A circular badge sticker: director's clapperboard with a spotlight beam illuminating a football boot on a stage. Flat vector illustration, dark teal (#1F2A33) and gold (#D4A853) palette. Solid bright magenta (#FF00FF) background, hard edges. No text. Square format, 512×512px.
```

**6. Nokia 3310 Award**
```
A circular badge sticker: iconic Nokia 3310 mobile phone rendered as an indestructible shield, football bouncing off it harmlessly, cracks in the ground around it but phone pristine. Flat vector illustration, dark teal (#1F2A33) and gold (#D4A853) palette. Solid bright magenta (#FF00FF) background, hard edges. No text. Square format, 512×512px.
```

**7. Series Exam Star**
```
A circular badge sticker: stack of exam papers/answer sheets with a gold star on top, football nestled among the papers. Flat vector illustration, dark teal (#1F2A33) and gold (#D4A853) palette. Solid bright magenta (#FF00FF) background, hard edges. No text. Square format, 512×512px.
```

**8. Desert Storm Award**
```
A circular badge sticker: football blazing through a sandstorm with lightning in the background, trail of fire behind it. Dramatic clutch-moment energy. Flat vector illustration, dark teal (#1F2A33) and gold (#D4A853) palette. Solid bright magenta (#FF00FF) background, hard edges. No text. Square format, 512×512px.
```

**9. Kanippayyur Jr.**
```
A circular badge sticker: small astrology wheel/horoscope chart with football at the center, modest oil lamp beside it. Humble local-astrologer energy. Flat vector illustration, dark teal (#1F2A33) and gold (#D4A853) palette. Solid bright magenta (#FF00FF) background, hard edges. No text. Square format, 512×512px.
```

**10. Rolling Trophy**
```
A circular badge sticker: large gleaming trophy cup with football on top, laurel wreath border, small team silhouettes around the base. Flat vector illustration, dark teal (#1F2A33) and gold (#D4A853) palette. Solid bright magenta (#FF00FF) background, hard edges. No text. Square format, 512×512px.
```
