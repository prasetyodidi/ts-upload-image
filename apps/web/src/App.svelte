<script lang="ts">
  import { onDestroy } from "svelte";
  import {
    ApiError,
    apiUrl,
    getJobStatus,
    uploadImage,
    type JobStatusResponse,
  } from "./lib/api";
  import { validateFile } from "./lib/file";
  import { pollJobStatus } from "./lib/poll";

  type Phase = "idle" | "uploading" | "pending" | "processing" | "completed" | "failed";

  let selectedFile = $state<File | null>(null);
  let previewUrl = $state<string | null>(null);
  let job = $state<JobStatusResponse | null>(null);
  let phase = $state<Phase>("idle");
  let message = $state<string | null>(null);
  let busy = $state(false);
  let fileInput: HTMLInputElement | undefined;
  let pollAbort: AbortController | null = null;

  const statusText: Record<Phase, string> = {
    idle: "Belum ada proses",
    uploading: "Mengunggah",
    pending: "Menunggu worker",
    processing: "Diproses",
    completed: "Selesai",
    failed: "Gagal",
  };

  const statusLabel = $derived(statusText[phase]);
  const downloadHref = $derived(
    job?.download_url ? apiUrl(job.download_url) : null,
  );
  const canUpload = $derived(
    selectedFile !== null &&
      !busy &&
      phase !== "uploading" &&
      phase !== "pending" &&
      phase !== "processing",
  );
  const isWorking = $derived(phase === "pending" || phase === "processing");

  const statusTone = $derived(
    phase === "completed"
      ? "bg-brand-mint"
      : phase === "failed"
        ? "bg-brand-coral/15"
        : "bg-surface-card",
  );

  const badgeTone = $derived(
    phase === "completed"
      ? "bg-canvas text-ink"
      : phase === "failed"
        ? "bg-brand-coral text-ink"
        : "bg-brand-ochre text-ink",
  );

  function segmentClass(index: number): string {
    if (phase === "failed") {
      return index < 2 ? "bg-brand-coral" : "bg-ink/10";
    }

    const current =
      phase === "completed" ? 4 : phase === "processing" ? 3 : phase === "pending" ? 2 : 1;
    if (index >= current) {
      return "bg-ink/10";
    }
    return phase === "completed" ? "bg-brand-mint" : "bg-brand-ochre";
  }

  function stopPolling(): void {
    pollAbort?.abort();
    pollAbort = null;
  }

  function clearPreview(): void {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }
  }

  function reset(): void {
    stopPolling();
    clearPreview();
    selectedFile = null;
    job = null;
    phase = "idle";
    message = null;
    busy = false;
    if (fileInput) {
      fileInput.value = "";
    }
  }

  function handleFile(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    clearPreview();
    message = null;
    job = null;
    phase = "idle";

    if (!file) {
      selectedFile = null;
      return;
    }

    const validationError = validateFile(file);
    if (validationError) {
      selectedFile = null;
      input.value = "";
      message = validationError;
      return;
    }

    selectedFile = file;
    previewUrl = URL.createObjectURL(file);
  }

  async function startPolling(jobId: string): Promise<void> {
    stopPolling();
    const controller = new AbortController();
    pollAbort = controller;

    try {
      await pollJobStatus({
        fetchStatus: (signal) => getJobStatus(jobId, signal),
        signal: controller.signal,
        onUpdate: (next) => {
          job = next;
          phase = next.status;
          if (next.status === "failed") {
            message = next.error?.message ?? "Pemrosesan gambar gagal.";
          }
        },
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      phase = "failed";
      message =
        error instanceof ApiError
          ? error.message
          : "Tidak dapat memantau status job.";
    } finally {
      if (pollAbort === controller) {
        pollAbort = null;
      }
    }
  }

  async function upload(): Promise<void> {
    if (!selectedFile || busy) {
      return;
    }

    stopPolling();
    busy = true;
    phase = "uploading";
    job = null;
    message = null;

    try {
      const uploaded = await uploadImage(selectedFile);
      job = {
        job_id: uploaded.job_id,
        status: "pending",
        created_at: uploaded.created_at,
        updated_at: uploaded.created_at,
      };
      phase = "pending";
      busy = false;
      void startPolling(uploaded.job_id);
    } catch (error) {
      busy = false;
      phase = "failed";
      message =
        error instanceof ApiError
          ? error.message
          : "Upload gagal. Periksa koneksi lalu coba lagi.";
    }
  }

  onDestroy(() => {
    stopPolling();
    clearPreview();
  });
</script>

<svelte:head>
  <title>Image Processing</title>
  <meta
    name="description"
    content="Upload gambar, proses di background, lalu unduh hasil WebP."
  />
</svelte:head>

<div class="min-h-dvh bg-canvas">
  <header
    class="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5 sm:px-8"
  >
    <div class="flex items-center gap-2.5">
      <span
        class="grid size-8 place-items-center rounded-[10px] bg-primary text-sm font-semibold text-on-primary"
        aria-hidden="true">t</span
      >
      <span class="font-display text-lg font-semibold tracking-[-0.04em] text-ink"
        >ts-upload-image</span
      >
    </div>
    <span
      class="rounded-pill border border-hairline bg-surface-soft px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted"
      >Image pipeline</span
    >
  </header>

  <main
    class="mx-auto grid w-full max-w-6xl gap-10 px-5 pb-20 pt-8 sm:px-8 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16 lg:pt-16"
  >
    <section class="max-w-2xl">
      <p
        class="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted"
      >
        Upload · process · download
      </p>
      <h1
        class="mt-5 font-display text-5xl font-medium leading-[0.98] tracking-[-0.055em] text-ink sm:text-6xl lg:text-7xl"
      >
        Resize, compress, convert.
      </h1>
      <p class="mt-6 max-w-xl text-base leading-relaxed text-body sm:text-lg">
        Upload JPG, PNG, atau WebP. Worker memprosesnya di background:
        resize ke maksimal 1280 px, compress 80%, lalu mengubahnya menjadi
        WebP.
      </p>

      <div class="mt-8 flex flex-wrap gap-2">
        {#each ["JPG · PNG · WebP", "Maks. 20 MB", "WebP 80%"] as item}
          <span
            class="rounded-pill border border-hairline bg-surface-card px-3 py-1.5 text-xs font-medium text-body"
            >{item}</span
          >
        {/each}
      </div>

      <div class="mt-12 grid gap-3 sm:grid-cols-3">
        <article class="rounded-card bg-brand-pink-strong p-5 text-on-primary">
          <p class="text-[11px] font-semibold uppercase tracking-[0.16em]">
            01
          </p>
          <h2 class="mt-8 font-display text-xl font-medium tracking-[-0.02em]">
            Upload
          </h2>
          <p class="mt-2 text-sm leading-relaxed">
            Validasi isi file dan simpan input sebelum job dibuat.
          </p>
        </article>
        <article class="rounded-card bg-brand-teal p-5 text-on-primary">
          <p class="text-[11px] font-semibold uppercase tracking-[0.16em] opacity-70">
            02
          </p>
          <h2 class="mt-8 font-display text-xl font-medium tracking-[-0.02em]">
            Process
          </h2>
          <p class="mt-2 text-sm leading-relaxed opacity-80">
            Worker mengambil job, memproses Sharp, lalu menyimpan hasil.
          </p>
        </article>
        <article class="rounded-card bg-brand-lavender p-5 text-ink">
          <p class="text-[11px] font-semibold uppercase tracking-[0.16em] opacity-70">
            03
          </p>
          <h2 class="mt-8 font-display text-xl font-medium tracking-[-0.02em]">
            Download
          </h2>
          <p class="mt-2 text-sm leading-relaxed text-ink/80">
            Pantau status dan unduh WebP saat job selesai.
          </p>
        </article>
      </div>
    </section>

    <section class="self-start lg:sticky lg:top-6">
      <form
        class="rounded-card border border-hairline bg-surface-card p-5 sm:p-7"
        onsubmit={(event) => {
          event.preventDefault();
          void upload();
        }}
      >
        <div class="flex items-start justify-between gap-4">
          <div>
            <h2 class="font-display text-2xl font-medium tracking-[-0.03em] text-ink">
              Mulai dari gambar
            </h2>
            <p class="mt-1 text-sm text-muted">
              Worker memproses di background.
            </p>
          </div>
          <span
            class="rounded-pill bg-canvas px-3 py-1 text-[11px] font-semibold text-muted"
            >20 MB</span
          >
        </div>

        <label
          class="mt-5 block cursor-pointer rounded-control border border-dashed border-hairline bg-canvas p-5 transition-colors hover:border-brand-teal/60 hover:bg-surface-soft focus-within:border-brand-teal"
          for="image"
        >
          <span class="block text-sm font-semibold text-ink">Pilih gambar</span>
          <span class="mt-1 block text-xs leading-relaxed text-muted">
            JPG, PNG, atau WebP · maksimal 20 MB
          </span>
          <input
            id="image"
            bind:this={fileInput}
            class="mt-4 block w-full text-xs text-body file:mr-3 file:rounded-control file:border-0 file:bg-primary file:px-3 file:py-2 file:text-xs file:font-semibold file:text-on-primary hover:file:bg-primary-active"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onchange={handleFile}
          />
        </label>

        {#if selectedFile}
          <div
            class="mt-4 flex items-center gap-3 rounded-control border border-hairline bg-canvas p-3"
          >
            {#if previewUrl}
              <img
                class="size-14 rounded-[10px] object-cover"
                src={previewUrl}
                alt="Preview gambar yang dipilih"
                width="56"
                height="56"
              />
            {/if}
            <div class="min-w-0">
              <p class="truncate text-sm font-semibold text-ink">
                {selectedFile.name}
              </p>
              <p class="mt-0.5 text-xs text-muted">
                {Math.ceil(selectedFile.size / 1024)} KB
              </p>
            </div>
          </div>
        {/if}

        {#if message && !job}
          <p
            class="mt-4 rounded-control border border-error/25 bg-error/10 p-3 text-sm leading-relaxed text-error"
            role="alert"
          >
            {message}
          </p>
        {/if}

        <button
          class="mt-5 inline-flex h-11 w-full items-center justify-center rounded-control bg-primary px-5 text-sm font-semibold text-on-primary transition-colors hover:bg-primary-active disabled:cursor-not-allowed disabled:bg-primary-disabled disabled:text-body"
          type="submit"
          disabled={!canUpload}
        >
          {#if phase === "uploading"}
            Mengunggah…
          {:else}
            Proses gambar
          {/if}
        </button>
      </form>

      {#if job}
        <section
          class="mt-4 rounded-card border border-hairline p-5 sm:p-6 {statusTone}"
          aria-live="polite"
          aria-busy={isWorking}
        >
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
              <p
                class="text-[10px] font-semibold uppercase tracking-[0.16em] text-body"
              >
                Job ID
              </p>
              <code class="mt-1 block break-all text-xs text-body"
                >{job.job_id}</code
              >
            </div>
            <span
              class="shrink-0 rounded-pill px-3 py-1 text-[11px] font-semibold {badgeTone}"
              >{statusLabel}</span
            >
          </div>

          <div class="mt-5 grid grid-cols-4 gap-1.5" aria-hidden="true">
            {#each [0, 1, 2, 3] as index}
              <span
                class="h-1.5 rounded-full {segmentClass(index)}"
              ></span>
            {/each}
          </div>

          {#if isWorking}
            <div class="mt-5 flex items-center gap-2.5 text-sm text-body">
              <span
                class="size-4 animate-spin rounded-full border-2 border-ink/15 border-t-ink motion-reduce:animate-none"
                aria-hidden="true"
              ></span>
              <p>
                {phase === "pending"
                  ? "Menunggu worker mengambil job."
                  : "Worker sedang memproses gambar."}
              </p>
            </div>
          {/if}

          {#if phase === "failed"}
            <p
              class="mt-4 rounded-control border border-error/25 bg-canvas/70 p-3 text-sm leading-relaxed text-error"
              role="alert"
            >
              {message ?? job.error?.message ?? "Pemrosesan gambar gagal."}
            </p>
          {/if}

          {#if phase === "completed" && downloadHref}
            <a
              class="mt-5 inline-flex h-11 w-full items-center justify-center rounded-control bg-primary px-5 text-sm font-semibold text-on-primary transition-colors hover:bg-primary-active"
              href={downloadHref}
              download
            >
              Download WebP
            </a>
          {/if}

          <button
            class="mt-3 inline-flex h-11 w-full items-center justify-center rounded-control border border-hairline bg-canvas px-5 text-sm font-semibold text-ink transition-colors hover:bg-surface-soft"
            type="button"
            onclick={reset}
          >
            Mulai lagi
          </button>
        </section>
      {/if}
    </section>
  </main>

  <footer class="border-t border-hairline bg-surface-soft">
    <div
      class="mx-auto flex w-full max-w-6xl flex-col gap-2 px-5 py-7 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-8"
    >
      <p>Async image processing demo.</p>
      <p>Sharp · BullMQ · Postgres · R2</p>
    </div>
  </footer>
</div>
