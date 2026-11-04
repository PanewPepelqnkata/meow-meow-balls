Ball Rush --- Tier Ball Visual & Character Creation Standard
Purpose: This document is the canonical production template for
designing, implementing, and validating every Ball Rush tier ball. Give
this file to the coding agent together with the specific character
prompt and visual reference(s). The agent must follow this standard for
every new ball.

Priority: Preserve the established Ball Rush art direction and
shared character system. New balls should feel like members of one
coherent collection, not unrelated illustrations.
1. Core art direction
Every ball must follow the same visual language:
- Cartoon-first, playful, expressive, collectible character
  design.
- Bold, dark, clean outlines with consistent visual weight.
- Simple, readable shapes that remain recognizable at the actual
  in-game size.
- Rich but controlled colors, with clear separation between body,
  facial features, accessories, and shading.
- Soft highlights and restrained shading that support the form rather
  than create a glossy 3D or photorealistic look.
- Slightly imperfect, hand-drawn character and silhouette details
  where appropriate.
- Cute, funny, memorable personality. A ball should communicate its
  character immediately.
- No generic AI-art appearance, photorealism, excessive gradients,
  unnecessary glow, noisy texture, or decorative clutter.
The silhouette comes first. At gameplay size, the body shape, face,
and defining accessory must read before small details. Do not compensate
for weak shapes by adding more texture.
1.1 Consistency across tiers
All balls share: - The same overall outline language and visual
weight. - The same approach to eye, pupil, eyelid, eyebrow, and mouth
construction. - Consistent shading and highlight conventions. -
Consistent scale rules for facial features. - The same animation and
physics integration principles. - A common rendering pipeline and asset
conventions.

Each tier must still have its own identity. Do not make every ball look
like the previous one with a different color or hat.
2. Character design brief --- required before implementation
For each new ball, establish the following from the user's prompt and
reference images. Do not invent details that conflict with the supplied
reference.
  Property                            Required direction
  Tier                                Exact tier number

  Character name                      Exact spelling, punctuation, and
capitalization

  Core concept                        One-sentence description of the
character

  Personality                         2--4 defining personality traits

  Main body                           Base color, secondary colors,
shading

  Face                                Eye style, expression, eyebrows,
mouth

  Defining feature                    The one feature that makes the ball
instantly recognizable

  Accessories                         Each accessory, its placement,
scale, and visual priority

  Surface details                     Only details that remain legible at
gameplay size

  Animation personality               Idle behavior and characteristic
reactions
Reference priority                  Which supplied image is the primary
visual reference
If the prompt includes a reference image, inspect it carefully before
coding. Identify its defining silhouette, proportions, color
relationships, facial expression, accessory placement, and outline
style. The reference is the source of truth for the requested character
concept; this standard governs how it is translated into Ball Rush.
3. Silhouette and proportions
3.1 Main body
- Use the existing tier configuration for the ball's gameplay radius
  and physics properties. Do not silently change tier progression.
- Preserve the game's organic, slightly irregular ball silhouette.
  Never turn every ball into a mathematically perfect circle.
- Irregularity must look intentional and controlled, not lumpy,
  broken, or noisy.
- The character must remain recognizable while rotating, deforming,
  colliding, and merging.
- Keep important facial features away from areas where normal
  deformation would make them clip or become unreadable.
3.2 Accessories and silhouette hierarchy
Every character should have a clear visual hierarchy:
1. Main body silhouette.
2. Face and expression.
3. Primary identifying feature or accessory.
4. Secondary accessories.
5. Small decorative details.
Accessories must be large enough to read at actual gameplay size. If an
accessory is a defining part of the character, it must not be hidden
behind the body or its outline.

For each accessory, specify: - Its anchor point relative to the ball. -
Its size relative to the ball radius. - Its rotation/tilt. - Whether it
sits behind, inside, or in front of the body. - How it behaves during
rotation and deformation. - Which parts need their own outline.

Avoid accessories that look pasted on, detached, embedded
unintentionally, or cut off.
4. Face construction
The face is the emotional center of each ball. Build it from clean,
reusable parts wherever the existing project architecture supports that
approach.
4.1 Eyes
- Keep eye shapes clean and readable at gameplay scale.
- Make eye placement intentional and balanced for the character's
  personality.
- Pupils must remain visible and correctly layered.
- Eyelids should have clean contours and must not accidentally cover
  the pupils.
- Use asymmetry only when it is an intentional part of the expression.
- Avoid tiny details that disappear at normal game scale.
4.2 Eyebrows
- Use eyebrows to reinforce personality and expression.
- Keep their shape and stroke weight consistent with the rest of the
  face.
- Ensure they do not collide awkwardly with hats, hair, or other
  accessories.
4.3 Mouth
- The mouth must remain recognizable at the actual gameplay size.
- Keep its outline clean and its shape appropriate to the character's
  personality.
- Ensure facial accessories, beards, moustaches, masks, or props do
  not obscure it unless explicitly intended.
4.4 Facial details
Freckles, blush, wrinkles, scars, facial hair, and similar details
should be deliberate and sparse. Avoid random dots, excessive marks, and
visual noise.
5. Outline, shape, and layering rules
Inconsistent layering is one of the fastest ways to make a character
look unfinished.
5.1 Outline quality
- Use the established Ball Rush outline color and stroke language.
- Keep outline weight visually consistent across the body, face, and
  accessories.
- Avoid doubled strokes where two outlined shapes overlap.
- Never let a thick outline cover the important interior of an
  accessory.
- Use clean joins and caps; avoid accidental spikes, gaps, and jagged
  edges.
- Inspect outlines at both close-up and actual gameplay size.
5.2 Recommended render hierarchy
Adapt this to the existing renderer rather than creating a parallel
rendering system:
1. Rear accessories and elements that sit behind the body.
2. Main body fill, shading, and body contour.
3. Internal body details and face base.
4. Facial features: eyebrows, eyes, pupils, mouth.
5. Facial hair or other elements according to their intended depth.
6. Foreground accessories and props.
7. Final visible outlines, highlights, and small finishing details.
This is a visual hierarchy, not a requirement that every part be a
separate object. Use masks, paths, clipping, or selective outline
rendering where necessary to prevent the body outline from crossing a
foreground accessory.
5.3 Overlap test
For every accessory overlap, explicitly check: - Does the accessory
appear in front of or behind the body as intended? - Does the body
outline incorrectly cross it? - Are there doubled black lines? - Is the
accessory still recognizable? - Does the overlap remain correct during
rotation and deformation?

Never fix a layering problem merely by making every stroke thicker.
6. Color, shading, and texture
- Use a small, deliberate palette with clear contrast.
- Keep the body as the dominant color area.
- Use secondary colors to separate features and accessories.
- Use highlights to describe form, not as random glossy spots.
- Use shading consistently with the rest of the collection.
- Keep textures subtle and sparse.
- Do not add gradients, glows, noise, or elaborate texture unless the
  reference and established art direction genuinely require them.
- Check color contrast on the actual game background.
A character must remain readable in motion and at reduced mobile sizes.
7. Character animation and Easter eggs
Every ball must integrate with the existing shared character
animation/Easter egg system. Do not create an isolated animation
framework for each new ball.

Implement only expressions and reactions supported by the existing
architecture, and extend the shared system when a reusable capability is
genuinely missing.
7.1 Baseline expression capabilities
Unless the game architecture or a specific character design
intentionally excludes an expression, every ball should support:
- Random blinking: close and reopen both eyes naturally.
- Random winking: close one eye while the other remains open.
- Random smile: briefly transition to a happier expression.
- Idle expression variation: occasional subtle personality changes.
- Fear reaction: show fear when the ball approaches the danger
  line/top of the container.
- Collision reaction: respond to a meaningful impact using the shared
  reaction system.
- Merge reaction: respond appropriately when participating in a merge.
7.2 Character-specific Easter eggs
Each character may have additional rare behaviors that express its
personality. Examples include: - A unique facial expression. - A brief
accessory movement. - A rare idle gesture. - A distinctive reaction to a
collision or near-game-over moment.

These must be occasional, readable, and consistent with the character
concept. Do not make every animation play constantly.
7.3 Animation quality requirements
- Use the existing animation timing, event system, and expression
  state where possible.
- Expressions must transition cleanly; avoid abrupt popping unless
  intentionally comedic.
- Avoid overlapping incompatible expressions.
- Ensure fear has appropriate priority near the danger line.
- Return to the normal idle expression after a temporary reaction.
- Do not replay animations on unrelated React rerenders or scene
  updates.
- Avoid unnecessary per-frame allocations, timers, listeners, and
  tweens.
- Respect reduced-motion preferences where the project supports them.
8. Physics, deformation, and attachment behavior
The character artwork must work with the existing Ball Rush physics and
slime deformation.
- Do not replace or bypass the existing Matter.js physics
  implementation.
- Do not change collision behavior or tier physics values unless
  explicitly requested.
- Facial features should follow the ball's deformation without
  drifting.
- Accessories should remain visually attached to their intended anchor
  points.
- Foreground and rear accessories must preserve their intended depth
  order.
- No accessory may detach, jitter independently, or remain at an old
  position after movement.
- Rotation must not cause the face or accessories to flip, detach, or
  clip unexpectedly.
- Keep deformation organic and controlled; the ball must not become a
  perfect static circle.
- Do not introduce expensive per-frame geometry rebuilding if the
  existing renderer has a cached or reusable approach.
For complex accessories, use a stable local coordinate system anchored
to the ball. Ensure all parts use the same transform and deformation
assumptions.
9. Asset and implementation standards
Before creating new assets or code: 1. Inspect the existing ball tier
configuration. 2. Inspect the current character/asset registry. 3.
Inspect the shared rendering and animation systems. 4. Inspect how
existing balls handle face parts, outlines, accessories, and
deformation. 5. Reuse established patterns and utilities.

Implementation rules: - Keep TypeScript strict and use existing project
conventions. - Avoid duplicated character systems. - Avoid hardcoded
tier values when a shared configuration exists. - Keep asset dimensions,
anchors, and scale metadata explicit. - Use deterministic asset
selection and animation behavior where appropriate for testing. - Do not
modify unrelated tiers or gameplay systems. - Do not add dependencies
unless necessary and justified. - Preserve performance optimizations
already present in the project.

If the project uses vector-drawn character parts, keep paths clean and
organized. If it uses raster assets, ensure transparent edges,
sufficient resolution, and correct anchor metadata. Follow the existing
project approach rather than introducing a new asset format.
10. Required visual review before calling a ball complete
A successful build does not prove that a character looks correct.

Review each character in at least these views:
1. Gameplay size: the normal size players see.
2. Close-up: inspect line quality, facial features, accessory
   construction, and overlap.
3. Different rotations: inspect the character while moving and
   rotating.
4. Deformed state: inspect during slime deformation and after
   collisions.
5. Expression states: inspect idle, blink, wink, smile, fear,
   collision, and merge reactions.
6. Mobile viewport: inspect at realistic mobile gameplay size.
Use actual screenshots from the running game. Do not rely only on a
source-code review or an enlarged static preview.
Visual acceptance checklist
- [ ] Character is immediately recognizable at gameplay size.
- [ ] Silhouette is clean, intentional, and not geometrically perfect.
- [ ] Face is readable and expressive.
- [ ] Accessories have correct size, placement, and depth.
- [ ] No accessory is unintentionally hidden by the body outline.
- [ ] No doubled, broken, jagged, or excessively thick outlines.
- [ ] No beard, hair, or other organic feature looks like disconnected
  geometric fragments.
- [ ] Color and shading match the Ball Rush art direction.
- [ ] Character remains readable on the game background.
- [ ] All animations work without clipping or flickering.
- [ ] Accessories remain attached during movement and deformation.
- [ ] Other tiers and shared gameplay systems remain unchanged.
11. Technical verification
Run the checks used by the project, including: - TypeScript typecheck. -
Lint. - Unit tests relevant to ball configuration, rendering, and
animation. - Production build.

Test the character in the actual game. If a dedicated test route is
requested, make it force the requested ball without changing normal
production selection or polluting real player progression, collection
unlocks, or leaderboard data.

Do not claim that a route is deployed or working until it has actually
been opened and tested after deployment.
12. Required completion report
For every new ball, report:
1. Tier number and exact character name.
2. Files created and modified.
3. How the character was registered in the existing tier and asset
   systems.
4. Which shared animation/Easter egg capabilities were reused or
   extended.
5. Typecheck, lint, tests, and build results.
6. Actual in-game screenshots at gameplay size and close-up.
7. Any remaining visual or technical limitations.
Clearly distinguish checks that were run from checks that could not be
performed. Never report an unverified mobile test, deployment, or URL as
successful.
13. Per-character prompt template
Use this section as the starting template whenever requesting a new ball
from the coding agent. Fill in the details for the specific character.
New ball request
- Tier: \(TIER NUMBER\)
- Name: \(CHARACTER NAME\)
- Concept: \(ONE-SENTENCE CONCEPT\)
- Personality: \(PERSONALITY TRAITS\)
- Body colors: \(COLORS\)
- Face: \(EYES / EYEBROWS / MOUTH / OTHER FEATURES\)
- Defining feature: \(MOST RECOGNIZABLE FEATURE\)
- Accessories: \(ACCESSORIES AND THEIR PLACEMENT\)
- Special Easter eggs: \(CHARACTER-SPECIFIC BEHAVIORS\)
- Reference images: \(ATTACHED REFERENCES\)
- Test route: \(OPTIONAL ROUTE, E.G. /character-test\)
Instructions to the coding agent
Implement this character as a real ball in the existing Ball Rush game.
Follow every applicable requirement in this document.

First inspect the current codebase and identify the existing tier,
rendering, accessory, deformation, and animation conventions. Then
implement the character by reusing those systems.

Treat the supplied character reference as the visual source of truth. Do
not improvise a different design. Prioritize silhouette, face
readability, accessory placement, outline quality, and correct layering
before adding small details.

Integrate the character into the correct tier and normal selection pool.
Preserve all other characters and gameplay behavior.

If a test route is requested, isolate the forced character selection to
that route and prevent test activity from affecting real player data.

Finally, run the technical checks, inspect actual in-game screenshots at
gameplay size and close-up, test the animation states, and provide the
completion report described above.

Do not declare the character finished just because the code compiles.
The actual in-game visual result must meet the visual acceptance
checklist.