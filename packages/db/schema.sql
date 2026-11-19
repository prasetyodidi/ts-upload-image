\restrict dbmate

-- Dumped from database version 17.11
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jobs (
    id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    run_id uuid,
    attempts integer DEFAULT 0 NOT NULL,
    created_at_ms bigint NOT NULL,
    updated_at_ms bigint NOT NULL,
    started_at_ms bigint,
    completed_at_ms bigint,
    failed_at_ms bigint,
    lease_expires_at_ms bigint,
    last_heartbeat_at_ms bigint,
    enqueued_at_ms bigint,
    input_key text NOT NULL,
    input_bytes bigint NOT NULL,
    input_mime text NOT NULL,
    output_key text,
    output_bytes bigint,
    output_width integer,
    output_height integer,
    output_sha256 text,
    error_code text,
    error_message text,
    error_detail jsonb,
    artifacts_cleaned_at_ms bigint,
    CONSTRAINT jobs_attempts_check CHECK ((attempts >= 0)),
    CONSTRAINT jobs_check CHECK (((status <> 'processing'::text) OR ((run_id IS NOT NULL) AND (lease_expires_at_ms IS NOT NULL)))),
    CONSTRAINT jobs_check1 CHECK (((status <> 'pending'::text) OR ((run_id IS NULL) AND (started_at_ms IS NULL)))),
    CONSTRAINT jobs_check2 CHECK (((status <> 'completed'::text) OR ((output_key IS NOT NULL) AND (completed_at_ms IS NOT NULL)))),
    CONSTRAINT jobs_check3 CHECK (((status <> 'failed'::text) OR ((error_code IS NOT NULL) AND (failed_at_ms IS NOT NULL)))),
    CONSTRAINT jobs_input_bytes_check CHECK ((input_bytes > 0)),
    CONSTRAINT jobs_input_mime_check CHECK ((input_mime = ANY (ARRAY['image/jpeg'::text, 'image/png'::text, 'image/webp'::text]))),
    CONSTRAINT jobs_output_bytes_check CHECK (((output_bytes IS NULL) OR (output_bytes > 0))),
    CONSTRAINT jobs_output_height_check CHECK (((output_height IS NULL) OR (output_height > 0))),
    CONSTRAINT jobs_output_width_check CHECK (((output_width IS NULL) OR (output_width > 0))),
    CONSTRAINT jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text])))
);


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version character varying NOT NULL
);


--
-- Name: jobs jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: jobs_failed_cleanup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jobs_failed_cleanup_idx ON public.jobs USING btree (updated_at_ms) WHERE (status = 'failed'::text);


--
-- Name: jobs_pending_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jobs_pending_created_idx ON public.jobs USING btree (created_at_ms) WHERE (status = 'pending'::text);


--
-- Name: jobs_processing_lease_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jobs_processing_lease_idx ON public.jobs USING btree (lease_expires_at_ms) WHERE (status = 'processing'::text);


--
-- Name: jobs_run_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX jobs_run_id_idx ON public.jobs USING btree (run_id) WHERE (run_id IS NOT NULL);


--
-- PostgreSQL database dump complete
--

\unrestrict dbmate


--
-- Dbmate schema migrations
--

INSERT INTO public.schema_migrations (version) VALUES
    ('20261119000100'),
    ('20261119000200');
