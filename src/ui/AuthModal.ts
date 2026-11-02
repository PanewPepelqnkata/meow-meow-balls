import { authService } from '../services/auth'

/**
 * Ball Rush Auth Modal — DOM-based login/signup overlay matching the game's
 * blue/red doodle aesthetic. Uses Lilita One font, Lucide icons, and the
 * navy/blue color palette from the design system.
 *
 * Username/password auth with optional email for password recovery.
 * Supabase requires email as primary identifier, so we look up email by
 * username for login, and store username in profile metadata on signup.
 */

export type AuthMode = 'login' | 'signup' | 'nickname'

interface AuthModalElements {
  backdrop: HTMLDivElement
  card: HTMLDivElement
  closeBtn: HTMLButtonElement
  tabLogin: HTMLButtonElement
  tabSignup: HTMLButtonElement
  form: HTMLFormElement
  usernameInput: HTMLInputElement
  passwordInput: HTMLInputElement
  emailInput: HTMLInputElement
  emailGroup: HTMLDivElement
  submitBtn: HTMLButtonElement
  errorBox: HTMLDivElement
  forgotLink: HTMLButtonElement
  forgotBox: HTMLDivElement
  forgotEmailInput: HTMLInputElement
  forgotSubmitBtn: HTMLButtonElement
  forgotCancelBtn: HTMLButtonElement
  nicknameBox: HTMLDivElement
  nicknameInput: HTMLInputElement
  nicknameSubmitBtn: HTMLButtonElement
  mode: AuthMode
}

export class AuthModal {
  private container: HTMLElement
  private els: AuthModalElements | null = null
  private successCb: (() => void) | null = null
  private cancelCb: (() => void) | null = null
  private isOpen = false
  private isLoading = false

  constructor(container: HTMLElement) {
    this.container = container
  }

  open(mode: AuthMode = 'login'): void {
    if (this.isOpen) return
    this.isOpen = true
    this.buildDOM(mode)
    this.bindEvents()
    this.els!.usernameInput.focus()
  }

  close(): void {
    if (!this.isOpen || !this.els) return
    this.isOpen = false
    this.els.backdrop.remove()
    this.els = null
    this.cancelCb?.()
  }

  onSuccess(cb: () => void): void {
    this.successCb = cb
  }

  onCancel(cb: () => void): void {
    this.cancelCb = cb
  }

  private buildDOM(mode: AuthMode): void {
    const backdrop = document.createElement('div')
    backdrop.className = 'auth-modal-backdrop'
    backdrop.innerHTML = `
      <div class="auth-modal-card">
        <button class="auth-modal-close" aria-label="Close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>

        <div class="auth-modal-tabs">
          <button type="button" class="auth-modal-tab ${mode === 'login' ? 'active' : ''}" data-mode="login">Login</button>
          <button type="button" class="auth-modal-tab ${mode === 'signup' ? 'active' : ''}" data-mode="signup">Sign Up</button>
        </div>

        <form class="auth-modal-form" novalidate>
          <div class="auth-input-group">
            <label class="auth-input-label" for="auth-username">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              Username
            </label>
            <input
              id="auth-username"
              type="text"
              class="auth-input"
              placeholder="Your username"
              autocomplete="username"
              required
              minlength="2"
              maxlength="24"
            />
          </div>

          <div class="auth-input-group">
            <label class="auth-input-label" for="auth-password">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              Password
            </label>
            <input
              id="auth-password"
              type="password"
              class="auth-input"
              placeholder="••••••••"
              autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}"
              required
              minlength="6"
            />
          </div>

          <div class="auth-input-group auth-email-group" style="display: ${mode === 'signup' ? 'block' : 'none'}">
            <label class="auth-input-label" for="auth-email">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
              Email <span class="auth-optional">(optional, for recovery)</span>
            </label>
            <input
              id="auth-email"
              type="email"
              class="auth-input"
              placeholder="you@example.com"
              autocomplete="email"
            />
          </div>

          <div class="auth-error" role="alert" style="display: none">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>
            <span class="auth-error-text"></span>
          </div>

          <button type="submit" class="auth-submit">
            <span class="auth-submit-text">${mode === 'login' ? 'Login' : 'Create Account'}</span>
            <span class="auth-submit-spinner" style="display: none">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="auth-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            </span>
          </button>

          <button type="button" class="auth-forgot-link" style="display: ${mode === 'login' ? 'block' : 'none'}">
            Forgot password?
          </button>
        </form>

        <div class="auth-forgot-box" style="display: none">
          <p class="auth-forgot-desc">Enter your email to receive a password reset link.</p>
          <div class="auth-input-group">
            <label class="auth-input-label" for="auth-forgot-email">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
              Email
            </label>
            <input
              id="auth-forgot-email"
              type="email"
              class="auth-input"
              placeholder="you@example.com"
              autocomplete="email"
            />
          </div>
          <div class="auth-forgot-actions">
            <button type="button" class="auth-submit auth-forgot-submit">Send Reset Link</button>
            <button type="button" class="auth-forgot-cancel">Back to Login</button>
          </div>
        </div>

        <div class="auth-nickname-box" style="display: none">
          <p class="auth-nickname-desc">This is how you'll appear on the leaderboard</p>
          <div class="auth-input-group">
            <label class="auth-input-label" for="auth-nickname">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              Nickname
            </label>
            <input
              id="auth-nickname"
              type="text"
              class="auth-input"
              placeholder="Your display name"
              autocomplete="off"
              required
              minlength="2"
              maxlength="20"
            />
          </div>
          <button type="button" class="auth-submit auth-nickname-submit">
            <span class="auth-submit-text">Continue</span>
            <span class="auth-submit-spinner" style="display: none">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="auth-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            </span>
          </button>
        </div>
      </div>
    `

    this.container.appendChild(backdrop)

    this.els = {
      backdrop,
      card: backdrop.querySelector('.auth-modal-card')!,
      closeBtn: backdrop.querySelector('.auth-modal-close')!,
      tabLogin: backdrop.querySelector('[data-mode="login"]')!,
      tabSignup: backdrop.querySelector('[data-mode="signup"]')!,
      form: backdrop.querySelector('.auth-modal-form')!,
      usernameInput: backdrop.querySelector('#auth-username')!,
      passwordInput: backdrop.querySelector('#auth-password')!,
      emailInput: backdrop.querySelector('#auth-email')!,
      emailGroup: backdrop.querySelector('.auth-email-group')!,
      submitBtn: backdrop.querySelector('.auth-submit')!,
      errorBox: backdrop.querySelector('.auth-error')!,
      forgotLink: backdrop.querySelector('.auth-forgot-link')!,
      forgotBox: backdrop.querySelector('.auth-forgot-box')!,
      forgotEmailInput: backdrop.querySelector('#auth-forgot-email')!,
      forgotSubmitBtn: backdrop.querySelector('.auth-forgot-submit')!,
      forgotCancelBtn: backdrop.querySelector('.auth-forgot-cancel')!,
      nicknameBox: backdrop.querySelector('.auth-nickname-box')!,
      nicknameInput: backdrop.querySelector('#auth-nickname')!,
      nicknameSubmitBtn: backdrop.querySelector('.auth-nickname-submit')!,
      mode,
    }
  }

  private bindEvents(): void {
    const { els } = this
    if (!els) return

    els.closeBtn.addEventListener('click', () => this.close())
    els.backdrop.addEventListener('click', (e) => {
      if (e.target === els.backdrop) this.close()
    })

    els.tabLogin.addEventListener('click', () => this.switchMode('login'))
    els.tabSignup.addEventListener('click', () => this.switchMode('signup'))

    // Prevent email input clicks from bubbling to tab buttons
    els.emailInput.addEventListener('click', (e) => {
      e.stopPropagation()
    })

    els.emailInput.addEventListener('focus', (e) => {
      e.stopPropagation()
    })

    els.form.addEventListener('submit', (e) => {
      e.preventDefault()
      this.handleSubmit()
    })

    els.forgotLink.addEventListener('click', () => {
      els.form.style.display = 'none'
      els.forgotBox.style.display = 'block'
      els.forgotEmailInput.focus()
    })

    els.forgotCancelBtn.addEventListener('click', () => {
      els.forgotBox.style.display = 'none'
      els.form.style.display = 'flex'
      this.hideError()
    })

    els.forgotSubmitBtn.addEventListener('click', () => this.handleForgotPassword())

    // Enter key in forgot email field
    els.forgotEmailInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        this.handleForgotPassword()
      }
    })

    els.nicknameSubmitBtn.addEventListener('click', () => this.handleNicknameSubmit())

    // Enter key in nickname field
    els.nicknameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        this.handleNicknameSubmit()
      }
    })
  }

  private switchMode(mode: AuthMode): void {
    if (!this.els || this.els.mode === mode) return
    this.els.mode = mode

    this.els.tabLogin.classList.toggle('active', mode === 'login')
    this.els.tabSignup.classList.toggle('active', mode === 'signup')

    this.els.emailGroup.style.display = mode === 'signup' ? 'block' : 'none'
    this.els.forgotLink.style.display = mode === 'login' ? 'block' : 'none'
    this.els.submitBtn.querySelector('.auth-submit-text')!.textContent =
      mode === 'login' ? 'Login' : 'Create Account'

    this.els.passwordInput.autocomplete = mode === 'login' ? 'current-password' : 'new-password'

    this.hideError()
    this.els.usernameInput.focus()
  }

  private async handleSubmit(): Promise<void> {
    const { els } = this
    if (!els || this.isLoading) return

    const username = els.usernameInput.value.trim()
    const password = els.passwordInput.value
    const email = els.emailInput.value.trim()

    // Validation
    if (!username || username.length < 2) {
      this.showError('Username must be at least 2 characters')
      return
    }
    if (!password || password.length < 6) {
      this.showError('Password must be at least 6 characters')
      return
    }
    if (els.mode === 'signup' && email && !this.isValidEmail(email)) {
      this.showError('Please enter a valid email address')
      return
    }

    this.setLoading(true)
    this.hideError()

    try {
      let result: { error: Error | null }

      if (els.mode === 'login') {
        result = await authService.signInWithUsername(username, password)
      } else {
        result = await authService.signUpWithUsername(username, password, email || undefined)
      }

      if (result.error) {
        this.showError(result.error.message)
        this.setLoading(false)
        return
      }

      // Success
      this.setLoading(false)

      if (els.mode === 'signup') {
        // Show nickname selection screen
        this.showNicknameScreen()
      } else {
        this.successCb?.()
        this.close()
      }
    } catch (err) {
      this.showError(err instanceof Error ? err.message : 'An unexpected error occurred')
      this.setLoading(false)
    }
  }

  private async handleForgotPassword(): Promise<void> {
    const { els } = this
    if (!els || this.isLoading) return

    const email = els.forgotEmailInput.value.trim()
    if (!email || !this.isValidEmail(email)) {
      this.showError('Please enter a valid email address')
      return
    }

    this.setLoading(true)
    this.hideError()

    try {
      const { error } = await authService.resetPassword(email)
      if (error) {
        this.showError(error.message)
      } else {
        this.showError('Password reset email sent! Check your inbox.', false)
        els.forgotEmailInput.value = ''
      }
    } catch (err) {
      this.showError(err instanceof Error ? err.message : 'Failed to send reset email')
    } finally {
      this.setLoading(false)
    }
  }

  private showNicknameScreen(): void {
    if (!this.els) return
    this.els.mode = 'nickname'
    this.els.form.style.display = 'none'
    this.els.nicknameBox.style.display = 'block'
    this.els.tabLogin.style.display = 'none'
    this.els.tabSignup.style.display = 'none'
    this.hideError()
    this.els.nicknameInput.focus()
  }

  private async handleNicknameSubmit(): Promise<void> {
    const { els } = this
    if (!els || this.isLoading) return

    const nickname = els.nicknameInput.value.trim()

    // Validation
    if (!nickname || nickname.length < 2) {
      this.showError('Nickname must be at least 2 characters')
      return
    }
    if (nickname.length > 20) {
      this.showError('Nickname must be 20 characters or less')
      return
    }

    this.setLoading(true)
    this.hideError()

    try {
      const { error } = await authService.updateDisplayName(nickname)

      if (error) {
        this.showError(error.message)
        this.setLoading(false)
        return
      }

      // Success
      this.setLoading(false)
      this.successCb?.()
      this.close()
    } catch (err) {
      this.showError(err instanceof Error ? err.message : 'An unexpected error occurred')
      this.setLoading(false)
    }
  }

  private showError(message: string, isError = true): void {
    if (!this.els) return
    this.els.errorBox.style.display = 'flex'
    this.els.errorBox.classList.toggle('auth-error--info', !isError)
    this.els.errorBox.querySelector('.auth-error-text')!.textContent = message
  }

  private hideError(): void {
    if (!this.els) return
    this.els.errorBox.style.display = 'none'
  }

  private setLoading(loading: boolean): void {
    if (!this.els) return
    this.isLoading = loading

    // Handle main form submit button
    this.els.submitBtn.disabled = loading
    const textEl = this.els.submitBtn.querySelector('.auth-submit-text') as HTMLElement
    const spinnerEl = this.els.submitBtn.querySelector('.auth-submit-spinner') as HTMLElement
    textEl.style.display = loading ? 'none' : 'inline'
    spinnerEl.style.display = loading ? 'inline' : 'none'

    // Handle nickname submit button
    this.els.nicknameSubmitBtn.disabled = loading
    const nicknameTextEl = this.els.nicknameSubmitBtn.querySelector('.auth-submit-text') as HTMLElement
    const nicknameSpinnerEl = this.els.nicknameSubmitBtn.querySelector('.auth-submit-spinner') as HTMLElement
    nicknameTextEl.style.display = loading ? 'none' : 'inline'
    nicknameSpinnerEl.style.display = loading ? 'inline' : 'none'
  }

  private isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  }
}
