BeforeAll {
  $modulePath = Join-Path (Split-Path $PSScriptRoot -Parent) 'lib/AdminPasswordReset.psm1'
  Import-Module $modulePath -Force
}

Describe 'Invoke-DocAiAdminPasswordReset' {
  BeforeEach {
    $global:AdminResetCallOrder = [System.Collections.Generic.List[string]]::new()
    Mock Add-ResetSecretVersion -ModuleName AdminPasswordReset {
      $global:AdminResetCallOrder.Add('add') | Out-Null
      '7'
    }
    Mock Set-ResetJobSecret -ModuleName AdminPasswordReset {
      $global:AdminResetCallOrder.Add("bind:$Version") | Out-Null
    }
    Mock Invoke-ResetJob -ModuleName AdminPasswordReset {
      $global:AdminResetCallOrder.Add('execute') | Out-Null
    }
    Mock Remove-ResetJobSecret -ModuleName AdminPasswordReset {
      $global:AdminResetCallOrder.Add('unbind') | Out-Null
    }
    Mock Disable-ResetSecretVersion -ModuleName AdminPasswordReset {
      $global:AdminResetCallOrder.Add("disable:$Version") | Out-Null
    }
  }

  AfterEach {
    Remove-Variable AdminResetCallOrder -Scope Global -ErrorAction SilentlyContinue
  }

  It 'binds one numeric version, waits for the job, removes the binding, and disables the version' {
    $password = ConvertTo-SecureString 'new-password-123' -AsPlainText -Force

    $result = Invoke-DocAiAdminPasswordReset -ProjectId 'project-1' -Region 'asia-southeast1' `
      -JobName 'docai-reset-password' -SecretId 'docai-admin-reset-password' -Password $password

    $result.Version | Should -Be '7'
    $result.SecretState | Should -Be 'DISABLED'
    ($global:AdminResetCallOrder -join ',') | Should -Be 'add,bind:7,execute,unbind,disable:7'
    Should -Invoke Add-ResetSecretVersion -ModuleName AdminPasswordReset -Times 1 -Exactly
    Should -Invoke Set-ResetJobSecret -ModuleName AdminPasswordReset -Times 1 -Exactly -ParameterFilter { $Version -eq '7' }
    Should -Invoke Invoke-ResetJob -ModuleName AdminPasswordReset -Times 1 -Exactly
    Should -Invoke Remove-ResetJobSecret -ModuleName AdminPasswordReset -Times 1 -Exactly
    Should -Invoke Disable-ResetSecretVersion -ModuleName AdminPasswordReset -Times 1 -Exactly -ParameterFilter { $Version -eq '7' }
  }

  It 'attempts both cleanup actions before rethrowing a job failure without exposing the password' {
    $testPassword = 'failure-password-456'
    $password = ConvertTo-SecureString $testPassword -AsPlainText -Force
    Mock Invoke-ResetJob -ModuleName AdminPasswordReset {
      $global:AdminResetCallOrder.Add('execute') | Out-Null
      throw 'job execution failed'
    }

    $captured = & {
      try {
        Invoke-DocAiAdminPasswordReset -ProjectId 'project-1' -Region 'asia-southeast1' `
          -JobName 'docai-reset-password' -SecretId 'docai-admin-reset-password' -Password $password
      } catch {
        $script:resetError = $_
      }
    } *>&1 | Out-String

    $script:resetError.Exception.Message | Should -Match 'job execution failed'
    $script:resetError.Exception.Message | Should -Not -Match ([regex]::Escape($testPassword))
    $captured | Should -Not -Match ([regex]::Escape($testPassword))
    ($global:AdminResetCallOrder -join ',') | Should -Be 'add,bind:7,execute,unbind,disable:7'
    Should -Invoke Remove-ResetJobSecret -ModuleName AdminPasswordReset -Times 1 -Exactly
    Should -Invoke Disable-ResetSecretVersion -ModuleName AdminPasswordReset -Times 1 -Exactly
  }

  It 'attempts version disable when removing the job binding also fails' {
    $password = ConvertTo-SecureString 'cleanup-password-789' -AsPlainText -Force
    Mock Remove-ResetJobSecret -ModuleName AdminPasswordReset {
      $global:AdminResetCallOrder.Add('unbind') | Out-Null
      throw 'unbind failed'
    }

    { Invoke-DocAiAdminPasswordReset -ProjectId 'project-1' -Region 'asia-southeast1' `
        -JobName 'docai-reset-password' -SecretId 'docai-admin-reset-password' -Password $password } |
      Should -Throw 'Operator reset cleanup failed for secret version 7*'

    Should -Invoke Disable-ResetSecretVersion -ModuleName AdminPasswordReset -Times 1 -Exactly
  }

  It 'rejects a nonnumeric Secret Manager version before binding the job' {
    $password = ConvertTo-SecureString 'invalid-version-password' -AsPlainText -Force
    Mock Add-ResetSecretVersion -ModuleName AdminPasswordReset { 'latest' }

    { Invoke-DocAiAdminPasswordReset -ProjectId 'project-1' -Region 'asia-southeast1' `
        -JobName 'docai-reset-password' -SecretId 'docai-admin-reset-password' -Password $password } |
      Should -Throw '*numeric Secret Manager version*'

    Should -Invoke Set-ResetJobSecret -ModuleName AdminPasswordReset -Times 0
  }
}
