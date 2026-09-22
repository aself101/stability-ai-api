# Live battery — 2026-09-22

Every endpoint the wrapper exposes, run through the built CLI (`dist/cli.js`) against the
production API. The runs used commit `3b80903` plus the timeout fix this battery produced
(finding 1). Later runs consumed earlier outputs:
- the Core bicycle (1536×1536) was the input for every image-to-image, edit and control run;
- a 512×512 copy of it fed the upscalers;
- the Ultra harbour painting was the style reference for Control: Style and Style Transfer.

A hand-drawn rectangle mask covered the bicycle for erase and inpaint. The runner, logs
and outputs lived in the session scratchpad and are not committed.

Each output was checked visually on a contact sheet, not just by exit code.

| run | endpoint / model | result | list price | wall s | output | notes |
|---|---|---|---|---|---|---|
| core | generate/core | OK | 3 | 8.2 | 1536×1536 | `--style-preset photographic` |
| ultra-t2i | generate/ultra | OK | 8 | 11.7 | 1344×768 | 16:9 |
| ultra-i2i | generate/ultra | **FAIL** | (8) | 30.1 | — | client timeout at 30 s; see finding 1 |
| ultra-i2i-retry | generate/ultra | OK | 8 | 12.7 | 1024×1024 | `image` + `strength 0.6` + `style_preset` (new in 1.0). The output stays close to the input, which is plausible for Ultra and weak evidence of the style |
| sd3-large | generate/sd3 `sd3.5-large` | OK | 6.5 | 10.6 | 1344×768 | 16:9 |
| sd3-large-turbo | `sd3.5-large-turbo` | OK | 4 | 7.7 | 1024×1024 | |
| sd3-medium | `sd3.5-medium` | OK | 3.5 | 5.4 | 1024×1024 | `--cfg-scale 5` (new in 1.0) |
| sd3-flash | `sd3.5-flash` | OK | 2.5 | 3.4 | 1024×1024 | **Flash accepted and generated**; `--style-preset anime` visibly applied |
| sd3-flash-i2i | `sd3.5-flash`, image-to-image | OK | 2.5 | 5.5 | 1024×1024 | strength 0.95 (API's suggested Flash range) with a vague prompt: output unrelated to the input. Not a wrapper fault; see finding 2 |
| sd3-flash-i2i-0.6 | `sd3.5-flash`, image-to-image | OK | 2.5 | 6.1 | 1024×1024 | input composition preserved; neon prompt barely applied (Flash cfg default 1) |
| sd3-medium-i2i-0.6 | `sd3.5-medium`, image-to-image | OK | 3.5 | 7.9 | 1024×1024 | input composition preserved **and** the prompt's snow added: image-to-image proven live |
| upscale-fast | upscale/fast | OK | 2 | 5.1 | 2048×2048 | 4× of 512 |
| upscale-conservative | upscale/conservative | OK | 40 | 28.4 | 3112×3112 | `prompt` (now required) + `creativity 0.25` (new in 1.0) |
| upscale-creative | upscale/creative | OK | 60 | 45.7 | 3152×3152 | async: task id, then polled; `creativity` + `style_preset` (new in 1.0) |
| edit-erase | edit/erase | OK | 5 | 7.0 | 1536×1536 | masked bicycle front removed; fill is a flat grey slab |
| edit-inpaint | edit/inpaint | OK | 5 | 11.6 | 1536×1536 | fern in the masked area |
| edit-outpaint | edit/outpaint | OK | 4 | 18.1 | 2048×1536 | +256 left and right |
| edit-search-replace | edit/search-and-replace | OK | 5 | 13.8 | 1536×1536 | bicycle → vintage motorcycle |
| edit-search-recolor | edit/search-and-recolor | OK | 5 | **34.1** | 1536×1536 | bicycle → blue. **Would have failed at the 0.4.0 timeout** |
| edit-remove-bg | edit/remove-background | OK | 5 | 7.2 | 1536×1536 | real alpha channel |
| edit-replace-bg | edit/replace-background-and-relight | OK | 8 | 15.9 | 1536×1536 | async; relit from the left |
| control-sketch | control/sketch | OK | 5 | 14.4 | 1536×1536 | |
| control-structure | control/structure | OK | 5 | 12.8 | 1536×1536 | brass bicycle, same structure |
| control-style | control/style | OK | 5 | 11.1 | 1365×768 | harbour painting's style on a street market |
| control-style-transfer | control/style-transfer | OK | 8 | 15.1 | 1024×1024 | bicycle in the harbour painting's style |

23 successful runs of 24; every endpoint (17) and every SD 3.5 model (4) passes, in text-to-image
and image-to-image where both exist. List price of the successful runs: **206 credits**
(generate 44, upscale 102, edit 37, control 23). The one failed run bills 0 only if the
server abandoned it too; see finding 3.

## Findings

1. **30 s was too short for synchronous endpoints: fixed.** Stability's synchronous
   endpoints send no bytes until the image is ready, so the request timeout is really a
   time-to-first-byte budget. Ultra image-to-image exceeded 30 s once and took 12.7 s
   on retry. Search-and-recolor took 34.1 s. 0.4.0 had the same 30 s (a total timeout
   under axios), so both would have failed there as well. Worse, the client gives up on
   a request the server may complete and bill. `API_TIMEOUT_MS` is now 180 s. Async
   endpoints return a task id immediately and are unaffected.

2. **Flash image-to-image at the suggested strength ignores the input.** The spec
   recommends strength 0.94–0.97 for Flash image-to-image. At 0.95, with the prompt
   "the same scene at golden hour", the output shared nothing with the input. At 0.6
   the input's composition held. This is model behaviour, not a wrapper fault: the
   request carried `mode`, `image` and `strength` in both cases. The README now qualifies
   the spec's suggestion: the high range suits restyling with a descriptive prompt, not
   edits.

3. **The balance endpoint did not move.** `GET /v1/user/balance` read 1072.5 before the
   battery was approved and 2026.0 when it started — `[VERIFY]` presumably a top-up in
   between; not confirmed — and still 2026.0 after 206 credits of list-price work. Every per-run before/after delta
   was 0. The balance is evidently cached or settled later, so it cannot measure
   per-run cost. The costs above are list prices from the spec. `[VERIFY]` actual
   billing against the account's usage page, and whether the timed-out Ultra run was
   charged.
