# frozen_string_literal: true

require 'spec_helper'

RSpec.describe 'User creates branch', :js, feature_category: :projects do
  include Spec::Support::Helpers::Features::BranchesHelpers

  let_it_be(:group) { create(:group, :public) }
  let_it_be(:user) { create(:user) }

  shared_examples 'creates new branch' do
    specify do
      branch_name = "deploy_keys_#{SecureRandom.hex(4)}"

      create_branch(branch_name)

      expect(page).to have_content(branch_name)
    end
  end

  shared_examples 'renders not found page' do
    specify do
      expect(page).to have_title('Not Found')
      expect(page).to have_content('Page Not Found')
    end
  end

  context 'when project is public with private repository' do
    let_it_be(:project) { create(:project, :public, :repository, :repository_private, group: group) }

    context 'when user is an inherited member from the group' do
      context 'and user is a guest' do
        before do
          group.add_guest(user)
          sign_in(user)

          visit(new_project_branch_path(project))
        end

        it_behaves_like 'renders not found page'
      end

      context 'and user is a developer' do
        before do
          group.add_developer(user)
          sign_in(user)

          visit(new_project_branch_path(project))
        end

        it_behaves_like 'creates new branch'
      end
    end
  end

  context 'when project is private' do
    let_it_be(:project) { create(:project, :private, :repository, group: group) }

    context 'when user is a direct project member' do
      context 'and user is a developer' do
        before do
          project.add_developer(user)
          sign_in(user)

          visit(new_project_branch_path(project))
        end

        context 'when on new branch page' do
          it 'renders I18n supported text' do
            page.within('#new-branch-form') do
              expect(page).to have_content(_('Branch name'))
              expect(page).to have_content(_('Create from'))
              expect(page).to have_content(_('Existing branch name, tag, or commit SHA'))
            end
          end
        end

        it_behaves_like 'creates new branch'

        context 'when branch name is invalid' do
          it 'does not create new branch' do
            invalid_branch_name = '1.0 stable'

            fill_in('branch_name', with: invalid_branch_name)
            page.find('body').click # defocus the branch_name input

            select_branch('master')
            click_button('Create branch')

            expect(page).to have_content('Branch name is invalid')
            expect(page).to have_content("can't contain spaces")
          end
        end

        context 'when branch name already exists' do
          it 'does not create new branch' do
            create_branch('master')

            expect(page).to have_content('Branch already exists')
          end
        end
      end
    end

    context 'when user is an inherited member from the group' do
      context 'and user is a guest' do
        before do
          group.add_guest(user)
          sign_in(user)

          visit(new_project_branch_path(project))
        end

        it_behaves_like 'renders not found page'
      end

      context 'and user is a developer' do
        before do
          group.add_developer(user)
          sign_in(user)

          visit(new_project_branch_path(project))
        end

        it_behaves_like 'creates new branch'
      end
    end
  end
end
