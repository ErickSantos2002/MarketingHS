import { useState, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableHeader, TableHead, TableRow, TableCell, TableBody } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UserPlus, KeyRound, Trash2, Loader2, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

interface AppUser {
  id: string;
  email: string;
  role: string;
  created_at: string;
  last_sign_in_at: string | null;
}

// O backend responde em português (`papel`); a tela fala `role`. A tradução
// mora aqui e em nenhum outro lugar.
interface UsuarioApi {
  id: string;
  email: string;
  papel: string;
  is_active: boolean;
  created_at: string;
  last_sign_in_at: string | null;
}

// Os três papéis de public.app_role. `leitura` (27/10) vê as telas do admin
// e não altera nada — o servidor dá 403 a qualquer escrita desse papel.
const PAPEIS: { valor: string; rotulo: string; descricao: string }[] = [
  { valor: 'admin', rotulo: 'Administrador', descricao: 'acesso total' },
  { valor: 'user', rotulo: 'Usuário', descricao: 'sem acesso ao painel' },
  { valor: 'leitura', rotulo: 'Leitura', descricao: 'vê tudo, não altera nada' },
];

function rotuloDoPapel(papel: string): string {
  return PAPEIS.find((p) => p.valor === papel)?.rotulo ?? papel;
}

export default function UserManagement() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);

  // Create user dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPapel, setNewPapel] = useState('user');
  const [creating, setCreating] = useState(false);

  // Reset password dialog
  const [resetOpen, setResetOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetUserId, setResetUserId] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetting, setResetting] = useState(false);

  // Delete confirm dialog
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteEmail, setDeleteEmail] = useState('');
  const [deleteUserId, setDeleteUserId] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Change email dialog
  const [changeEmailOpen, setChangeEmailOpen] = useState(false);
  const [changeEmailUserId, setChangeEmailUserId] = useState('');
  const [changeEmailOld, setChangeEmailOld] = useState('');
  const [changeEmailNew, setChangeEmailNew] = useState('');
  const [changingEmail, setChangingEmail] = useState(false);
  const [togglingRole, setTogglingRole] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const lista = await api.get<UsuarioApi[]>('/usuarios');
      setUsers(lista.map((u) => ({
        id: u.id, email: u.email, role: u.papel,
        created_at: u.created_at, last_sign_in_at: u.last_sign_in_at,
      })));
    } catch {
      toast.error('Erro ao carregar usuários');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleCreate = async () => {
    if (!newEmail || !newPassword) {
      toast.error('Preencha email e senha');
      return;
    }
    if (newPassword.length < 8) {
      toast.error('Senha deve ter no mínimo 8 caracteres');
      return;
    }
    setCreating(true);
    try {
      await api.post('/usuarios', {
        email: newEmail, senha: newPassword, papel: newPapel,
      });
      toast.success('Usuário criado com sucesso');
      setCreateOpen(false);
      setNewEmail('');
      setNewPassword('');
      setNewPapel('user');
      fetchUsers();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Erro ao criar usuário');
    } finally {
      setCreating(false);
    }
  };

  const handleResetPassword = async () => {
    if (!resetPassword || resetPassword.length < 8) {
      toast.error('Senha deve ter no mínimo 8 caracteres');
      return;
    }
    setResetting(true);
    try {
      await api.post(`/usuarios/${resetUserId}/senha`, { senha: resetPassword });
      toast.success('Senha alterada com sucesso');
      setResetOpen(false);
      setResetPassword('');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Erro ao resetar senha');
    } finally {
      setResetting(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.delete(`/usuarios/${deleteUserId}`);
      toast.success('Usuário excluído');
      setDeleteOpen(false);
      fetchUsers();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Erro ao excluir usuário');
    } finally {
      setDeleting(false);
    }
  };

  const handleChangeEmail = async () => {
    if (!changeEmailNew || !changeEmailNew.includes('@')) {
      toast.error('Informe um email válido');
      return;
    }
    setChangingEmail(true);
    try {
      await api.patch(`/usuarios/${changeEmailUserId}/email`, { email: changeEmailNew });
      toast.success('Email alterado com sucesso');
      setChangeEmailOpen(false);
      setChangeEmailNew('');
      fetchUsers();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Erro ao alterar email');
    } finally {
      setChangingEmail(false);
    }
  };

  const handleChangeRole = async (userId: string, currentRole: string, newRole: string) => {
    if (newRole === currentRole) return;
    setTogglingRole(userId);
    try {
      await api.patch(`/usuarios/${userId}/papel`, { papel: newRole });
      toast.success(`Papel alterado para ${rotuloDoPapel(newRole)}`);
      fetchUsers();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Erro ao alterar role');
    } finally {
      setTogglingRole(null);
    }
  };

  return (
    <>
      <Card className="border-border/40">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Usuários da plataforma</CardTitle>
            <CardDescription className="text-xs mt-0.5">
              Gerencie os acessos ao painel administrativo
            </CardDescription>
          </div>
          <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
            <UserPlus className="h-3.5 w-3.5" /> Novo Usuário
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Papel</TableHead>
                  <TableHead>Criado em</TableHead>
                  <TableHead>Último login</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="text-xs font-medium">{u.email}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Select
                          value={u.role}
                          disabled={togglingRole === u.id}
                          onValueChange={(v) => handleChangeRole(u.id, u.role, v)}
                        >
                          <SelectTrigger className="h-7 w-[150px] text-xs" aria-label={`Papel de ${u.email}`}>
                            <SelectValue>{rotuloDoPapel(u.role)}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {PAPEIS.map((p) => (
                              <SelectItem key={p.valor} value={p.valor} className="text-xs">
                                {p.rotulo}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {togglingRole === u.id && (
                          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(u.created_at).toLocaleDateString('pt-BR')}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleDateString('pt-BR') : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Alterar email"
                          onClick={() => {
                            setChangeEmailUserId(u.id);
                            setChangeEmailOld(u.email);
                            setChangeEmailNew('');
                            setChangeEmailOpen(true);
                          }}
                        >
                          <Mail className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Resetar senha"
                          onClick={() => {
                            setResetEmail(u.email);
                            setResetUserId(u.id);
                            setResetPassword('');
                            setResetOpen(true);
                          }}
                        >
                          <KeyRound className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-[--on-tint-danger] hover:text-[--on-tint-danger] hover:bg-[--tint-danger]"
                          title="Excluir usuário"
                          onClick={() => {
                            setDeleteEmail(u.email);
                            setDeleteUserId(u.id);
                            setDeleteOpen(true);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {users.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-xs text-muted-foreground py-8">
                      Nenhum usuário encontrado
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create User Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo Usuário</DialogTitle>
            <DialogDescription>Crie um novo acesso ao painel</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium mb-1 block">Email</label>
              <Input
                type="email"
                placeholder="email@exemplo.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Senha</label>
              <Input
                type="password"
                placeholder="Mínimo 8 caracteres"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="papel-novo" className="text-xs font-medium mb-1 block">Papel</label>
              <Select value={newPapel} onValueChange={setNewPapel}>
                <SelectTrigger id="papel-novo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAPEIS.map((p) => (
                    <SelectItem key={p.valor} value={p.valor}>
                      {p.rotulo} ({p.descricao})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={creating} className="gap-1.5">
              {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resetar Senha</DialogTitle>
            <DialogDescription>Nova senha para {resetEmail}</DialogDescription>
          </DialogHeader>
          <div>
            <label className="text-xs font-medium mb-1 block">Nova senha</label>
            <Input
              type="password"
              placeholder="Mínimo 8 caracteres"
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(false)}>Cancelar</Button>
            <Button onClick={handleResetPassword} disabled={resetting} className="gap-1.5">
              {resetting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir Usuário</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir <strong>{deleteEmail}</strong>? Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting} className="gap-1.5">
              {deleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change Email Dialog */}
      <Dialog open={changeEmailOpen} onOpenChange={setChangeEmailOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Alterar Email</DialogTitle>
            <DialogDescription>Novo email de acesso para {changeEmailOld}</DialogDescription>
          </DialogHeader>
          <div>
            <label className="text-xs font-medium mb-1 block">Novo email</label>
            <Input
              type="email"
              placeholder="novo@email.com"
              value={changeEmailNew}
              onChange={(e) => setChangeEmailNew(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChangeEmailOpen(false)}>Cancelar</Button>
            <Button onClick={handleChangeEmail} disabled={changingEmail} className="gap-1.5">
              {changingEmail && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
