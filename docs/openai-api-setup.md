# OpenAI API setup for the owner

ChatGPT Plus does **not** include API usage. API billing is managed separately.

1. Sign in at [platform.openai.com](https://platform.openai.com/).
2. Create a project named `Private Wardrobe`.
3. Open Billing, add a payment method and buy a small prepaid balance. The
   current documented minimum is USD 5; verify the amount shown in your account.
4. Auto recharge is enabled by default in the prepaid setup. Turn it off if you
   do not want automatic top-ups. Credits expire after one year and are
   non-refundable.
5. In project **Limits**, set a modest monthly budget and alerts (for example at
   50%, 80% and 100%). A project budget is a notification threshold, not a hard
   stop: requests may continue after the threshold.
6. In **Model usage**, allow only the configured vision and image models and
   reduce per-model rate limits to what this single-user app needs.
7. In project **API Keys**, create a project-scoped restricted key. Grant only
   the endpoints required for Responses and image editing where the UI permits.
8. Copy the key once into Hostinger's `OPENAI_API_KEY` environment variable.
   Never send it through chat/email or commit it.
9. Start with `OPENAI_IMAGE_QUALITY=medium`. Change it to `high` only after
   reviewing output and actual spend.
10. Review real usage in the OpenAI Usage/Billing dashboard. The application's
    usage page is a request-count estimate only.
11. If a key may be compromised, revoke it in the project API Keys page, create
    a new key, update Hostinger, and redeploy/restart.

Official references:

- [ChatGPT Plus and separate API billing](https://help.openai.com/en/articles/6950777-what)
- [Prepaid API billing](https://help.openai.com/en/articles/8264644-manage-your-chatgpt-subscription)
- [Projects, key permissions, model limits and soft budgets](https://help.openai.com/en/articles/9186755-managing-your-work-in-the-api-platform-with-projects)
- [API key safety](https://help.openai.com/en/articles/5112595-best-practices-fo)

See [security](security.md) and [operations](operations.md).
