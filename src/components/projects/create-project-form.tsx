"use client";

import type { EnvironmentType } from "@avenor/types";
import { Badge, Button, Card, FormField, PageHeader, Textarea, TextInput } from "@avenor/ui";
import Link from "next/link";
import * as React from "react";

export interface CreateProjectFormProps {
  workspaceId: string;
  workspaceName: string;
  organizationName: string;
}

export function CreateProjectForm({
  workspaceId,
  workspaceName,
  organizationName,
}: CreateProjectFormProps) {
  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [slugTouched, setSlugTouched] = React.useState(false);
  const [primaryDomain, setPrimaryDomain] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [includeStaging, setIncludeStaging] = React.useState(true);
  const [includeDevelopment, setIncludeDevelopment] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  function deriveSlug(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setErrorMessage(null);
    if (name.trim().length < 2) {
      setErrorMessage("Enter a logical product name (at least 2 characters).");
      return;
    }

    const initialEnvironments: EnvironmentType[] = ["PRODUCTION"];
    if (includeStaging) {
      initialEnvironments.push("STAGING");
    }
    if (includeDevelopment) {
      initialEnvironments.push("DEVELOPMENT");
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          name: name.trim(),
          slug: slug.trim() || undefined,
          primaryDomain: primaryDomain.trim() || null,
          description: description.trim() || null,
          initialEnvironments,
        }),
      });
      const payload = (await response.json()) as {
        project?: { id: string };
        error?: { message?: string };
      };
      if (!response.ok || !payload.project) {
        setErrorMessage(payload.error?.message ?? "Unable to create logical product.");
        return;
      }

      window.location.assign(`/projects/${payload.project.id}`);
    } catch {
      setErrorMessage("Network error while creating logical product.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader
        breadcrumbs={[
          { label: organizationName },
          { label: workspaceName, href: "/dashboard" },
          { label: "Projects", href: "/projects" },
          { label: "New Logical Product" },
        ]}
        title="Create Logical Digital Product"
        description="Register a website, web application, or API service to group its Production, Staging, and Development environments under a single product identity."
        badges={<Badge tone="indigo">Product-Centered Model</Badge>}
      />

      <Card className="p-5 sm:p-6">
        <form onSubmit={handleSubmit} className="space-y-5" data-testid="create-project-form">
          {errorMessage ? (
            <div
              role="alert"
              className="rounded-[10px] border border-[#BF4256]/30 bg-[#FDECEF] px-3.5 py-2.5 text-[13px] font-medium text-[#BF4256]"
            >
              {errorMessage}
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              id="project-name"
              label="Product name"
              required
              hint="Human-readable name of the website or application."
            >
              <TextInput
                id="project-name"
                data-testid="project-name-input"
                value={name}
                onChange={(event) => {
                  const next = event.target.value;
                  setName(next);
                  if (!slugTouched) {
                    setSlug(deriveSlug(next));
                  }
                }}
                placeholder="Avenor Marketing Website"
                required
              />
            </FormField>

            <FormField
              id="project-slug"
              label="Workspace-scoped slug"
              hint="Lowercase alphanumeric & hyphens. Scoped to this workspace."
            >
              <TextInput
                id="project-slug"
                data-testid="project-slug-input"
                value={slug}
                onChange={(event) => {
                  setSlugTouched(true);
                  setSlug(event.target.value);
                }}
                placeholder="avenor-marketing-website"
              />
            </FormField>
          </div>

          <FormField
            id="project-domain"
            label="Primary production domain (optional)"
            hint="Used to display canonical URL context across Signal Atlas views."
          >
            <TextInput
              id="project-domain"
              data-testid="project-domain-input"
              value={primaryDomain}
              onChange={(event) => setPrimaryDomain(event.target.value)}
              placeholder="https://avenor.dev"
            />
          </FormField>

          <FormField id="project-description" label="Product description (optional)">
            <Textarea
              id="project-description"
              data-testid="project-description-input"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Public marketing web property, documentation hub, and changelog."
              rows={3}
            />
          </FormField>

          <div className="rounded-[12px] border border-[#DFE6F0] bg-[#F7F9FC] p-4 space-y-3">
            <div>
              <p className="text-[14px] font-semibold text-[#17243A]">Environment Tiers</p>
              <p className="text-[13px] text-[#64748B]">
                Production is always provisioned as the default environment. Select any additional
                tiers to provision now (you can also add them later).
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-6">
              <label className="inline-flex items-center gap-2 text-[13px] font-medium text-[#17243A]">
                <input
                  type="checkbox"
                  checked
                  disabled
                  className="h-4 w-4 rounded accent-[#5157D9]"
                />
                <span>PRODUCTION (Default)</span>
              </label>

              <label className="inline-flex items-center gap-2 text-[13px] font-medium text-[#17243A]">
                <input
                  type="checkbox"
                  data-testid="create-project-staging-checkbox"
                  checked={includeStaging}
                  onChange={(e) => setIncludeStaging(e.target.checked)}
                  className="h-4 w-4 rounded accent-[#5157D9]"
                />
                <span>STAGING</span>
              </label>

              <label className="inline-flex items-center gap-2 text-[13px] font-medium text-[#17243A]">
                <input
                  type="checkbox"
                  data-testid="create-project-development-checkbox"
                  checked={includeDevelopment}
                  onChange={(e) => setIncludeDevelopment(e.target.checked)}
                  className="h-4 w-4 rounded accent-[#5157D9]"
                />
                <span>DEVELOPMENT</span>
              </label>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <Link
              href="/projects"
              className="inline-flex h-10 items-center justify-center rounded-[10px] border border-[#C7D2E3] bg-[#FFFFFF] px-4 text-[14px] font-medium text-[#17243A] hover:bg-[#F0F4FA]"
            >
              Cancel
            </Link>
            <Button
              type="submit"
              variant="primary"
              data-testid="create-project-submit"
              disabled={submitting}
            >
              {submitting ? "Creating product..." : "Create Logical Product"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
