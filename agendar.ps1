# Cria uma tarefa agendada do Windows que busca vagas e notifica, mesmo com o painel fechado.
# Uso (no PowerShell, dentro da pasta do projeto):
#   .\agendar.ps1                     # a cada 60 min, das 8h às 22h
#   .\agendar.ps1 -IntervaloMin 30    # outro intervalo
#   .\agendar.ps1 -Remover            # desfaz
# Se usar a tarefa, pode desligar a busca automática do painel (config.json → automatico.ativo = false)
# para não consultar as fontes em dobro.
param([int]$IntervaloMin = 60, [switch]$Remover)

$nome = "Busca de Vagas"
if ($Remover) {
    Unregister-ScheduledTask -TaskName $nome -Confirm:$false
    "Tarefa '$nome' removida."
    return
}

$node = (Get-Command node -ErrorAction Stop).Source
$acao = New-ScheduledTaskAction -Execute $node -Argument "buscar.mjs --notificar" -WorkingDirectory $PSScriptRoot
$gatilho = New-ScheduledTaskTrigger -Daily -At 8am
$gatilho.Repetition = (New-ScheduledTaskTrigger -Once -At 8am -RepetitionInterval (New-TimeSpan -Minutes $IntervaloMin) -RepetitionDuration (New-TimeSpan -Hours 14)).Repetition
$opcoes = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 15)

# Roda como o seu usuário, só com você logado (necessário para a notificação aparecer).
Register-ScheduledTask -TaskName $nome -Action $acao -Trigger $gatilho -Settings $opcoes `
    -Description "Busca vagas remotas a cada $IntervaloMin min (8h-22h) e notifica as novas com boa chance." -Force | Out-Null
"Tarefa '$nome' criada: a cada $IntervaloMin min, das 8h às 22h. Para remover: .\agendar.ps1 -Remover"
