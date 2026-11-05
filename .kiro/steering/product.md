---
inclusion: always
---

# Product: Needalaata (నీడలాట)

## Name
**Needalaata** (నీడలాట) means "shadow play" in Telugu: *neeḍa* (shadow) + *āṭa* (play), echoing *Bommalāṭa* in Tholu Bommalata. Subtitle on screen: **"shadow tales of India"**. Repo: `needalaata`.

## One-line pitch
A haunted shadow theatre in your browser: cast hand shadows into your webcam to perform Indian folk tales, and bring the dying art of Tholu Bommalata, Andhra's colored leather shadow-puppet theatre, back to life.

## The problem (Potential Impact)
Tholu Bommalata and South India's other shadow-puppet traditions (Togalu Gombeyata, Tholpavakoothu, Thol Bommalattam) are disappearing. Performer families are dwindling and young audiences never encounter the form. Needalaata lets anyone with a webcam perform a shadow play: kids learn classic Indian tales by acting them out, teachers get a ready-made classroom experience, and the art gets a digital afterlife.

## Who it's for
- Kids and students (8+) learning Indian folk tales and folk art
- Teachers running storytelling or cultural sessions
- Anyone curious about Indian heritage, through a playful, spooky experience

## Experience flow
1. **The Abandoned Theatre** – a dark, dusty stage at night, torn screen, faded leather puppets hanging lifeless. No narrator character; the place itself tells you it has been forgotten (dust, cobwebs, silence, a cold unlit lamp).
2. **Light the Lamp** – the user raises an open palm; the oil lamp flickers to life. This is the onboarding gesture and teaches the hand-tracking interaction.
3. **Choose a Tale** – hanging puppets/scrolls represent each story. The user selects one by pointing.
4. **Perform the Tale** – short narrated captions advance the story. At each cue, the user casts the right hand shadow; our trained classifier recognizes it and the leather puppet awakens joint by joint, then follows the user's hand as they puppeteer it.
5. **The Theatre Revives** – each completed tale relights one more lamp, mends part of the screen and brings color back to the stage. Completing all tales fully restores the theatre.

## Phase 1 tales
| Tale | Source | Shadows used |
|---|---|---|
| The Lion and the Clever Rabbit | Panchatantra | rabbit, lion |
| The Crow and the Snake | Panchatantra | bird, snake |
| The Monkey and the Crocodile | Panchatantra | crocodile, bird (monkey stand-in unless a reliable monkey shadow is found) |
| Punchkin – the sorcerer whose soul hid in a parrot | Deccan folktale (*Old Deccan Days*, 1868) | bird (parrot), demon |
| Kolli Deyyam – the fire ghosts of the fields (stretch) | Original tale inspired by Telugu folklore | bird or rabbit, plus drifting ghost lights |

Halloween tone comes from the setting and from the two spooky tales (Punchkin, Kolli Deyyam).

## Shadow vocabulary (classifier labels)
| Label | Hand shadow (validate during data collection) |
|---|---|
| `rabbit` | One hand, index + middle fingers raised as ears |
| `lion` | Dog-head shape (thumb up as ear, pinky lowered as jaw) with the other hand's spread fingers behind as a mane |
| `bird` | Two hands crossed and linked at the thumbs, fingers spread as wings |
| `snake` | Forearm raised, hand arched forward with fingers together like a cobra's hood |
| `crocodile` | Two hands stacked palm-to-palm, opening and closing like jaws |
| `demon` | Both hands raised, fingers curled as claws |
| `none` | Anything else / no hands |

If two labels get confused in testing, redesign one of the shadows rather than forcing the model.

## Signature visual
Tholu Bommalata puppets are translucent, painted leather, so their shadows glow in color (unlike black silhouettes elsewhere). The screen must show jewel-toned colored shadows lit by a flickering lamp. This is the Costume Contest weapon.

## Phase 2 (not in scope now)
- Ramayana episodes (Golden Deer, Hanuman, Rama, Ravana)
- More tales, more puppets

## Non-goals for Phase 1
- Multiplayer
- Training any large model from scratch
- Mobile-first layout (desktop webcam is the target device)

## Category
Costume Contest (also eligible for Best Student Project: Costume Contest). The Resurrection framing ("shadow play was India's first projection technology") is used in the pitch either way.