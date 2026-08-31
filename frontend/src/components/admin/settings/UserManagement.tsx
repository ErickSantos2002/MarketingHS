import { useState, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableHeader, TableHead, TableRow, TableCell, TableBody } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { UserPlus, KeyRound, Trash2, Loader2, Shield, User, Mail, ShieldCheck, ShieldOff } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

interface AppUser {
  id: string;
  email: string;
  role: string;
  created_at: string;
  last_sign_in_at: string | null;
}

export default function UserManagement() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);

  // Create user dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newIsAdmin, setNewIsAdmin] = useState(false);
  const [creating, setCreating] = useState(false);

  // Reset password dialog
  const [resetOpen, setResetOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetting, setResetting] = useState(false);

  // Delete confirm dialog
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteEmail, setDeleteEmail] = useState('');
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
      const { data, error } = await supabase.functions.invoke('list-users');
      if (error) throw error;
      setUsers(data.users || []);
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
    if (newPassword.length < 6) {
      toast.error('Senha deve ter no mínimo 6 caracteres');
      return;
    }
    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-user', {
        body: { email: newEmail, password: newPassword, role: newIsAdmin ? 'admin' : 'user' },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success('Usuário criado com sucesso');
      setCreateOpen(false);
      setNewEmail('');
      setNewPassword('');
      setNewIsAdmin(false);
      fetchUsers();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Erro ao criar usuário');
    } finally {
      setCreating(false);
    }
  };

  const handleResetPassword = async () => {
    if (!resetPassword || resetPassword.length < 6) {
      toast.error('Senha deve ter no mínimo 6 caracteres');
      return;
    }
    setResetting(true);
    try {
      const { data, error } = await supabase.functions.invoke('reset-user-password', {
        body: { email: resetEmail, newPassword: resetPassword },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
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
      const { data, error } = await supabase.functions.invoke('delete-user', {
        body: { email: deleteEmail },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
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
      const { data, error } = await supabase.functions.invoke('update-user-email', {
        body: { userId: changeEmailUserId, newEmail: changeEmailNew },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
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

  const handleToggleRole = async (userId: string, currentRole: string) => {
    const newRole = currentRole === 'admin' ? 'user' : 'admin';
    setTogglingRole(userId);
    try {
      const { data, error } = await supabase.functions.invoke('update-user-role', {
        body: { userId, newRole },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`Role alterado para ${newRole}`);
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
                  <TableHead>Role</TableHead>
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
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1 text-[10px] h-6 px-2"
                        disabled={togglingRole === u.id}
                        onClick={() => handleToggleRole(u.id, u.role)}
                        title={u.role === 'admin' ? 'Rebaixar para user' : 'Promover a admin'}
                      >
                        {togglingRole === u.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : u.role === 'admin' ? (
                          <Shield className="h-3 w-3" />
                        ) : (
                          <User className="h-3 w-3" />
                        )}
                        <Badge variant={u.role === 'admin' ? 'default' : 'secondary'} className="text-[10px] pointer-events-none">
                          {u.role}
                        </Badge>
                      </Button>
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
                            setResetPassword('');
                            setResetOpen(true);
                          }}
                        >
                          <KeyRound className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          title="Excluir usuário"
                          onClick={() => {
                            setDeleteEmail(u.email);
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
                placeholder="Mínimo 6 caracteres"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="admin-check"
                checked={newIsAdmin}
                onCheckedChange={(v) => setNewIsAdmin(v === true)}
              />
              <label htmlFor="admin-check" className="text-xs">
                Administrador (acesso total)
              </label>
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
              placeholder="Mínimo 6 caracteres"
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
